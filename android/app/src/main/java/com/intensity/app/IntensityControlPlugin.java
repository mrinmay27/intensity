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

                // DUMP ALL KEYS for the primary back camera (usually ID 0 or the one with
                // flash)
                if (id.equals("0") || (hasFlash != null && hasFlash)) {
                    List<CameraCharacteristics.Key<?>> keys = characteristics.getKeys();
                    JSArray keyNames = new JSArray();
                    for (CameraCharacteristics.Key<?> key : keys) {
                        keyNames.put(key.getName());
                    }
                    info.put("keys", keyNames);
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
        Boolean burstAll = call.getBoolean("burst", false);

        Context context = getContext();
        CameraManager cameraManager = (CameraManager) context.getSystemService(Context.CAMERA_SERVICE);

        try {
            List<String> targetIds = new ArrayList<>();
            if (burstAll) {
                String[] ids = cameraManager.getCameraIdList();
                for (String id : ids)
                    targetIds.add(id);
                for (int i = 0; i < 11; i++) {
                    String si = String.valueOf(i);
                    if (!targetIds.contains(si))
                        targetIds.add(si);
                }
            } else {
                targetIds.add(forceId != null ? forceId : "0");
            }

            for (String id : targetIds) {
                try {
                    if (forceLevel != null) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            cameraManager.turnOnTorchWithStrengthLevel(id, forceLevel);
                        }
                    } else if (intensity != null) {
                        if (intensity <= 0) {
                            cameraManager.setTorchMode(id, false);
                        } else {
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                                try {
                                    // Try strength first, even if it reports max 1
                                    int level = (int) Math.round(intensity * 10);
                                    level = Math.max(1, level);
                                    cameraManager.turnOnTorchWithStrengthLevel(id, level);
                                } catch (Exception e) {
                                    cameraManager.setTorchMode(id, true);
                                }
                            } else {
                                cameraManager.setTorchMode(id, true);
                            }
                        }
                    }
                } catch (Exception e) {
                    if (!burstAll)
                        throw e;
                }
            }

            JSObject ret = new JSObject();
            ret.put("success", true);
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

        for (int i = 0; i < 21; i++) {
            String id = String.valueOf(i);
            try {
                CameraCharacteristics c = cameraManager.getCameraCharacteristics(id);
                Boolean hasFlash = c.get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
                Integer maxL = 0;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    maxL = c.get(CameraCharacteristics.FLASH_INFO_STRENGTH_MAXIMUM_LEVEL);
                }
                found.add(id + (hasFlash != null && hasFlash ? "⚡" : "") + (maxL != null ? "d" + maxL : ""));
            } catch (Exception e) {
            }
        }

        scanResult = "IDs: " + String.join(", ", found);
        JSObject ret = new JSObject();
        ret.put("result", scanResult);
        call.resolve(ret);
    }
}
