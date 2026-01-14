package com.intensity.app;

import android.content.Context;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "IntensityControl")
public class IntensityControlPlugin extends Plugin {

    private static final String TAG = "IntensityControl";

    @PluginMethod
    public void getFlashHardwareInfo(PluginCall call) {
        Context context = getContext();
        CameraManager cameraManager = (CameraManager) context.getSystemService(Context.CAMERA_SERVICE);
        JSArray results = new JSArray();

        try {
            for (String id : cameraManager.getCameraIdList()) {
                CameraCharacteristics characteristics = cameraManager.getCameraCharacteristics(id);
                Boolean hasFlash = characteristics.get(CameraCharacteristics.FLASH_INFO_AVAILABLE);

                if (hasFlash != null && hasFlash) {
                    JSObject info = new JSObject();
                    info.put("id", id);

                    Integer lensFacing = characteristics.get(CameraCharacteristics.LENS_FACING);
                    String facing = "UNKNOWN";
                    if (lensFacing != null) {
                        if (lensFacing == CameraCharacteristics.LENS_FACING_BACK)
                            facing = "BACK";
                        else if (lensFacing == CameraCharacteristics.LENS_FACING_FRONT)
                            facing = "FRONT";
                        else if (lensFacing == CameraCharacteristics.LENS_FACING_EXTERNAL)
                            facing = "EXTERNAL";
                    }
                    info.put("facing", facing);

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        Integer maxLevel = characteristics.get(CameraCharacteristics.FLASH_INFO_STRENGTH_MAXIMUM_LEVEL);
                        info.put("maxLevel", maxLevel != null ? maxLevel : 1);
                    } else {
                        info.put("maxLevel", 1);
                        info.put("note", "Requires Android 13+");
                    }
                    results.put(info);
                }
            }
            JSObject response = new JSObject();
            response.put("cameras", results);
            response.put("androidVersion", Build.VERSION.RELEASE);
            response.put("sdkInt", Build.VERSION.SDK_INT);
            call.resolve(response);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void setIntensity(PluginCall call) {
        Double intensity = call.getDouble("intensity");
        String forceId = call.getString("cameraId"); // Allow forcing a specific camera ID

        if (intensity == null) {
            call.reject("Intensity value (0.0 - 1.0) is required");
            return;
        }

        Context context = getContext();
        CameraManager cameraManager = (CameraManager) context.getSystemService(Context.CAMERA_SERVICE);

        try {
            String cameraId = forceId;
            if (cameraId == null) {
                // Auto-selector logic
                for (String id : cameraManager.getCameraIdList()) {
                    CameraCharacteristics characteristics = cameraManager.getCameraCharacteristics(id);
                    Boolean hasFlash = characteristics.get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
                    Integer lensFacing = characteristics.get(CameraCharacteristics.LENS_FACING);
                    if (hasFlash != null && hasFlash && lensFacing != null
                            && lensFacing == CameraCharacteristics.LENS_FACING_BACK) {
                        cameraId = id;
                        break;
                    }
                }
            }

            if (cameraId == null) {
                String[] ids = cameraManager.getCameraIdList();
                if (ids.length > 0)
                    cameraId = ids[0];
            }

            if (cameraId == null) {
                call.reject("No camera found");
                return;
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                CameraCharacteristics characteristics = cameraManager.getCameraCharacteristics(cameraId);
                Integer maxLevel = characteristics.get(CameraCharacteristics.FLASH_INFO_STRENGTH_MAXIMUM_LEVEL);

                if (maxLevel != null && maxLevel > 1) {
                    if (intensity <= 0) {
                        cameraManager.setTorchMode(cameraId, false);
                    } else {
                        int level = (int) Math.round(intensity * maxLevel);
                        level = Math.max(1, Math.min(maxLevel, level));
                        cameraManager.turnOnTorchWithStrengthLevel(cameraId, level);
                    }
                } else {
                    cameraManager.setTorchMode(cameraId, intensity > 0);
                }
            } else {
                cameraManager.setTorchMode(cameraId, intensity > 0);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }
}
