package com.intensity.app;

import android.Manifest;
import android.content.Context;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

@CapacitorPlugin(name = "IntensityControl", permissions = {
        @Permission(alias = "camera", strings = { Manifest.permission.CAMERA })
})
public class IntensityControlPlugin extends Plugin {

    private static final String TAG = "IntensityControl";
    private String lastStatus = "Unknown";
    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override
    public void load() {
        super.load();
        setupTorchCallback();
    }

    private void setupTorchCallback() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            CameraManager cameraManager = (CameraManager) getContext().getSystemService(Context.CAMERA_SERVICE);
            cameraManager.registerTorchCallback(new CameraManager.TorchCallback() {
                @Override
                public void onTorchModeChanged(String cameraId, boolean enabled) {
                    super.onTorchModeChanged(cameraId, enabled);
                    lastStatus = "ID:" + cameraId + " " + (enabled ? "ON" : "OFF");
                }

                @Override
                public void onTorchModeUnavailable(String cameraId) {
                    super.onTorchModeUnavailable(cameraId);
                    lastStatus = "ID:" + cameraId + " UNAVAILABLE";
                }
            }, handler);
        }
    }

    @PluginMethod
    public void getFlashHardwareInfo(PluginCall call) {
        Context context = getContext();
        CameraManager cameraManager = (CameraManager) context.getSystemService(Context.CAMERA_SERVICE);
        JSArray results = new JSArray();

        try {
            for (String id : cameraManager.getCameraIdList()) {
                CameraCharacteristics characteristics = cameraManager.getCameraCharacteristics(id);
                Boolean hasFlash = characteristics.get(CameraCharacteristics.FLASH_INFO_AVAILABLE);

                JSObject info = new JSObject();
                info.put("id", id);
                info.put("hasFlash", hasFlash != null && hasFlash);

                Integer lensFacing = characteristics.get(CameraCharacteristics.LENS_FACING);
                String facing = "UNKNOWN";
                if (lensFacing != null) {
                    if (lensFacing == CameraCharacteristics.LENS_FACING_BACK)
                        facing = "BACK";
                    else if (lensFacing == CameraCharacteristics.LENS_FACING_FRONT)
                        facing = "FRONT";
                }
                info.put("facing", facing);

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    Integer maxLevel = characteristics.get(CameraCharacteristics.FLASH_INFO_STRENGTH_MAXIMUM_LEVEL);
                    info.put("maxLevel", maxLevel != null ? maxLevel : (hasFlash != null && hasFlash ? 1 : 0));
                } else {
                    info.put("maxLevel", hasFlash != null && hasFlash ? 1 : 0);
                }
                results.put(info);
            }

            JSObject response = new JSObject();
            response.put("cameras", results);
            response.put("manufacturer", Build.MANUFACTURER);
            response.put("model", Build.MODEL);
            response.put("torchStatus", lastStatus);
            call.resolve(response);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void setIntensity(PluginCall call) {
        Double intensity = call.getDouble("intensity");
        String forceId = call.getString("cameraId");

        if (intensity == null) {
            call.reject("Intensity required");
            return;
        }

        Context context = getContext();
        CameraManager cameraManager = (CameraManager) context.getSystemService(Context.CAMERA_SERVICE);

        try {
            String cameraId = forceId;
            if (cameraId == null) {
                // Auto-selector
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
                // Fallback to ANY in list if auto-selector failed
                if (cameraId == null && cameraManager.getCameraIdList().length > 0) {
                    cameraId = cameraManager.getCameraIdList()[0];
                }
            }

            if (cameraId == null) {
                call.reject("No camera ID found");
                return;
            }

            // Always try setTorchMode FIRST for maximum compatibility, then
            // turnOnTorchWithStrengthLevel
            if (intensity <= 0) {
                cameraManager.setTorchMode(cameraId, false);
            } else {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    CameraCharacteristics characteristics = cameraManager.getCameraCharacteristics(cameraId);
                    Integer maxLevel = characteristics.get(CameraCharacteristics.FLASH_INFO_STRENGTH_MAXIMUM_LEVEL);
                    if (maxLevel != null && maxLevel > 1) {
                        int level = (int) Math.round(intensity * maxLevel);
                        level = Math.max(1, Math.min(maxLevel, level));
                        cameraManager.turnOnTorchWithStrengthLevel(cameraId, level);
                    } else {
                        cameraManager.setTorchMode(cameraId, true);
                    }
                } else {
                    cameraManager.setTorchMode(cameraId, true);
                }
            }

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("id", cameraId);
            ret.put("status", lastStatus);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void bruteForceAll(PluginCall call) {
        Context context = getContext();
        CameraManager cameraManager = (CameraManager) context.getSystemService(Context.CAMERA_SERVICE);
        try {
            String[] ids = cameraManager.getCameraIdList();
            for (String id : ids) {
                try {
                    cameraManager.setTorchMode(id, true);
                } catch (Exception e) {
                    Log.e(TAG, "Failed to force ID:" + id);
                }
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }
}
