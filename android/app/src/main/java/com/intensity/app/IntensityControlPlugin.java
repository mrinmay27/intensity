package com.intensity.app;

import android.Manifest;
import android.content.Context;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.os.Build;
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

                Integer hwLevel = characteristics.get(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL);
                String hwLevelStr = "OTHER";
                if (hwLevel != null) {
                    if (hwLevel == CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_3)
                        hwLevelStr = "LEVEL_3";
                    else if (hwLevel == CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_FULL)
                        hwLevelStr = "FULL";
                }
                info.put("hwLevel", hwLevelStr);

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
            call.resolve(response);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void setIntensity(PluginCall call) {
        Double intensity = call.getDouble("intensity");
        if (intensity == null) {
            call.reject("Intensity required");
            return;
        }

        Context context = getContext();
        CameraManager cameraManager = (CameraManager) context.getSystemService(Context.CAMERA_SERVICE);

        try {
            String cameraId = null;
            // Best candidate selection
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

            if (cameraId == null) {
                call.reject("Hardware not found");
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

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("id", cameraId);
            ret.put("val", intensity);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Native Error: " + e.getMessage());
            call.reject(e.getMessage());
        }
    }
}
