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

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

@CapacitorPlugin(name = "IntensityControl", permissions = {
        @Permission(alias = "camera", strings = { Manifest.permission.CAMERA })
})
public class IntensityControlPlugin extends Plugin {

    private static final String TAG = "IntensityControl";
    private String lastStatus = "Unknown";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private String scanResult = "";

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
            String[] idList = cameraManager.getCameraIdList();
            for (String id : idList) {
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
            response.put("scanResult", scanResult);
            call.resolve(response);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void setIntensity(PluginCall call) {
        Double intensity = call.getDouble("intensity");
        String forceId = call.getString("cameraId");
        Integer forceLevel = call.getInt("forceLevel");

        if (intensity == null && forceLevel == null) {
            call.reject("Intensity required");
            return;
        }

        Context context = getContext();
        CameraManager cameraManager = (CameraManager) context.getSystemService(Context.CAMERA_SERVICE);

        try {
            String cameraId = forceId != null ? forceId : "0";

            if (forceLevel != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    cameraManager.turnOnTorchWithStrengthLevel(cameraId, forceLevel);
                    JSObject ret = new JSObject();
                    ret.put("success", true);
                    ret.put("id", cameraId);
                    ret.put("status", "FORCED:" + forceLevel);
                    call.resolve(ret);
                    return;
                }
            }

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
    public void deepScan(PluginCall call) {
        Context context = getContext();
        CameraManager cameraManager = (CameraManager) context.getSystemService(Context.CAMERA_SERVICE);
        List<String> found = new ArrayList<>();

        // Try IDs 0 to 20
        for (int i = 0; i < 21; i++) {
            String id = String.valueOf(i);
            try {
                // Just check if it exists in characteristics first
                CameraCharacteristics c = cameraManager.getCameraCharacteristics(id);
                Boolean hasFlash = c.get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
                Integer maxL = 0;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    maxL = c.get(CameraCharacteristics.FLASH_INFO_STRENGTH_MAXIMUM_LEVEL);
                }
                found.add(id + (hasFlash != null && hasFlash ? "⚡" : "")
                        + (maxL != null && maxL > 0 ? "dim:" + maxL : ""));
            } catch (Exception e) {
            }
        }

        scanResult = "Found IDs: " + String.join(", ", found);

        JSObject ret = new JSObject();
        ret.put("result", scanResult);
        call.resolve(ret);
    }

    @PluginMethod
    public void bruteForceAll(PluginCall call) {
        Context context = getContext();
        CameraManager cameraManager = (CameraManager) context.getSystemService(Context.CAMERA_SERVICE);
        try {
            // First try official list
            String[] ids = cameraManager.getCameraIdList();
            for (String id : ids) {
                try {
                    cameraManager.setTorchMode(id, true);
                } catch (Exception e) {
                }
            }
            // Then try common hidden IDs
            for (int i = 0; i < 11; i++) {
                try {
                    cameraManager.setTorchMode(String.valueOf(i), true);
                } catch (Exception e) {
                }
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }
}
