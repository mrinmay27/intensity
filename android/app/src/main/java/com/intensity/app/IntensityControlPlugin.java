package com.intensity.app;

import android.Manifest;
import android.content.Context;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
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
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private String scanResult = "";

    // PWM Control variables
    private HandlerThread pwmThread;
    private Handler pwmHandler;
    private volatile boolean isRunningPWM = false;
    private volatile long currentOnTime = 0;
    private volatile String currentCid = "0";
    private static final long PWM_PERIOD = 20; // Faster frequency (50Hz) to reduce flicker

    @Override
    public void load() {
        super.load();
        setupTorchCallback();
        startPWMThread();
    }

    private void startPWMThread() {
        if (pwmThread != null)
            return;
        pwmThread = new HandlerThread("IntensityPWM");
        pwmThread.start();
        pwmHandler = new Handler(pwmThread.getLooper());
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
            }, mainHandler);
        }
    }

    @PluginMethod
    public void getFlashHardwareInfo(PluginCall call) {
        CameraManager cameraManager = (CameraManager) getContext().getSystemService(Context.CAMERA_SERVICE);
        JSArray results = new JSArray();
        try {
            for (String id : cameraManager.getCameraIdList()) {
                CameraCharacteristics characteristics = cameraManager.getCameraCharacteristics(id);
                Boolean hasFlash = characteristics.get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
                JSObject info = new JSObject();
                info.put("id", id);
                info.put("hasFlash", hasFlash != null && hasFlash);
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
        currentCid = call.getString("cameraId", "0");
        Boolean usePWM = call.getBoolean("usePWM", false);

        CameraManager cameraManager = (CameraManager) getContext().getSystemService(Context.CAMERA_SERVICE);

        try {
            if (intensity != null && intensity > 0 && intensity < 1.0 && usePWM) {
                currentOnTime = (long) (PWM_PERIOD * intensity);
                if (!isRunningPWM) {
                    isRunningPWM = true;
                    runPWM(cameraManager);
                }
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("status", "PWM ACTIVE (" + (int) (intensity * 100) + "%)");
                call.resolve(ret);
            } else {
                isRunningPWM = false;
                if (pwmHandler != null)
                    pwmHandler.removeCallbacksAndMessages(null);

                if (intensity == null || intensity <= 0) {
                    cameraManager.setTorchMode(currentCid, false);
                } else {
                    // Try native strength even if it says 1, just in case reporting is wrong
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        try {
                            int level = (int) Math.round(intensity * 10);
                            cameraManager.turnOnTorchWithStrengthLevel(currentCid, Math.max(1, level));
                        } catch (Exception e) {
                            cameraManager.setTorchMode(currentCid, true);
                        }
                    } else {
                        cameraManager.setTorchMode(currentCid, true);
                    }
                }

                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("status", lastStatus);
                call.resolve(ret);
            }
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    private void runPWM(final CameraManager cm) {
        if (!isRunningPWM)
            return;
        pwmHandler.post(new Runnable() {
            @Override
            public void run() {
                if (!isRunningPWM)
                    return;
                try {
                    if (currentOnTime > 0) {
                        cm.setTorchMode(currentCid, true);
                        Thread.sleep(Math.max(1, currentOnTime));
                    }
                    if (currentOnTime < PWM_PERIOD) {
                        cm.setTorchMode(currentCid, false);
                        Thread.sleep(Math.max(1, PWM_PERIOD - currentOnTime));
                    }
                    pwmHandler.post(this);
                } catch (Exception e) {
                    pwmHandler.post(this);
                }
            }
        });
    }

    @PluginMethod
    public void deepScan(PluginCall call) {
        CameraManager cameraManager = (CameraManager) getContext().getSystemService(Context.CAMERA_SERVICE);
        List<String> found = new ArrayList<>();
        try {
            String[] ids = cameraManager.getCameraIdList();
            for (String id : ids) {
                CameraCharacteristics c = cameraManager.getCameraCharacteristics(id);
                Boolean flashRaw = c.get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
                Integer maxL = 0;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    maxL = c.get(CameraCharacteristics.FLASH_INFO_STRENGTH_MAXIMUM_LEVEL);
                }
                String note = "";
                // Search for Anything related to Nothing or Glyph in Vendor Tags if possible
                // (This is just a scan, actual value reading is harder without knowing keys)
                found.add(id + ":" + (flashRaw != null && flashRaw ? "⚡" : "") + "m" + (maxL != null ? maxL : "1"));
            }
            scanResult = "IDs: " + String.join(", ", found);
            JSObject ret = new JSObject();
            ret.put("result", scanResult);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void dumpAllCharacteristics(PluginCall call) {
        String targetId = call.getString("cameraId", "0");
        CameraManager cameraManager = (CameraManager) getContext().getSystemService(Context.CAMERA_SERVICE);
        JSArray lines = new JSArray();
        try {
            CameraCharacteristics c = cameraManager.getCameraCharacteristics(targetId);
            List<CameraCharacteristics.Key<?>> keys = c.getKeys();
            for (CameraCharacteristics.Key<?> key : keys) {
                try {
                    Object val = c.get(key);
                    lines.put(key.getName() + " = " + (val != null ? val.toString() : "null"));
                } catch (Exception e) {
                }
            }
            JSObject res = new JSObject();
            res.put("data", lines);
            call.resolve(res);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }
}
