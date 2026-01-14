package com.intensity.app;

import android.content.Context;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "IntensityControl")
public class IntensityControlPlugin extends Plugin {

    private static final String TAG = "IntensityControl";

    private String getBackCameraWithFlash(CameraManager cameraManager) throws CameraAccessException {
        for (String id : cameraManager.getCameraIdList()) {
            CameraCharacteristics characteristics = cameraManager.getCameraCharacteristics(id);
            Boolean hasFlash = characteristics.get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
            Integer lensFacing = characteristics.get(CameraCharacteristics.LENS_FACING);
            if (hasFlash != null && hasFlash && lensFacing != null
                    && lensFacing == CameraCharacteristics.LENS_FACING_BACK) {
                return id;
            }
        }
        return null;
    }

    @PluginMethod
    public void checkSupport(PluginCall call) {
        Context context = getContext();
        CameraManager cameraManager = (CameraManager) context.getSystemService(Context.CAMERA_SERVICE);
        JSObject ret = new JSObject();
        try {
            String cameraId = getBackCameraWithFlash(cameraManager);
            if (cameraId == null) {
                ret.put("supported", false);
                ret.put("maxLevel", 0);
                ret.put("error", "No camera with flash found");
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                CameraCharacteristics characteristics = cameraManager.getCameraCharacteristics(cameraId);
                Integer maxLevel = characteristics.get(CameraCharacteristics.FLASH_INFO_STRENGTH_MAXIMUM_LEVEL);
                ret.put("supported", maxLevel != null && maxLevel > 1);
                ret.put("maxLevel", maxLevel != null ? maxLevel : 1);
            } else {
                ret.put("supported", false);
                ret.put("maxLevel", 1);
                ret.put("reason", "Android version below 13");
            }
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void setIntensity(PluginCall call) {
        Double intensity = call.getDouble("intensity");
        if (intensity == null) {
            call.reject("Intensity value (0.0 - 1.0) is required");
            return;
        }

        Context context = getContext();
        CameraManager cameraManager = (CameraManager) context.getSystemService(Context.CAMERA_SERVICE);

        try {
            String cameraId = getBackCameraWithFlash(cameraManager);
            if (cameraId == null) {
                String[] ids = cameraManager.getCameraIdList();
                if (ids.length > 0)
                    cameraId = ids[0];
            }

            if (cameraId == null) {
                call.reject("No camera found with flashlight support");
                return;
            }

            // Implementation for Dimming (Android 13+ / API 33+)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                CameraCharacteristics characteristics = cameraManager.getCameraCharacteristics(cameraId);
                Integer maxLevel = characteristics.get(CameraCharacteristics.FLASH_INFO_STRENGTH_MAXIMUM_LEVEL);

                if (maxLevel != null && maxLevel > 1) {
                    if (intensity <= 0) {
                        cameraManager.setTorchMode(cameraId, false);
                    } else {
                        // Map 0.0-1.0 to 1-maxLevel
                        int level = (int) Math.round(intensity * maxLevel);
                        level = Math.max(1, Math.min(maxLevel, level));
                        cameraManager.turnOnTorchWithStrengthLevel(cameraId, level);
                        Log.d(TAG, "Hardware Dimming: Set level " + level + " of " + maxLevel);
                    }
                } else {
                    // Hardware doesn't support dimming, fallback to binary
                    cameraManager.setTorchMode(cameraId, intensity > 0);
                    Log.d(TAG, "Hardware Fallback: Device does not support granular intensity levels.");
                }
            } else {
                // Legacy Android Fallback
                cameraManager.setTorchMode(cameraId, intensity > 0);
                Log.d(TAG, "Legacy Fallback: Android version < 13. Using binary ON/OFF.");
            }
            call.resolve();
        } catch (CameraAccessException e) {
            Log.e(TAG, "Camera Access Error", e);
            call.reject("Camera access error: " + e.getMessage());
        } catch (Exception e) {
            Log.e(TAG, "General Torch Error", e);
            call.reject("Flashlight error: " + e.getMessage());
        }
    }
}
