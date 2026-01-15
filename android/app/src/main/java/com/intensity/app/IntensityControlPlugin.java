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
    private static final long PWM_PERIOD = 30; // 33Hz for better dimming/less flicker

    @Override
    public void load() {
        super.load();
        setupTorchCallback();
        startPWMThread();
    }

    private void startPWMThread() {
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
                    info.put("maxLevel", maxLevel != null ? maxLevel : 1);
                } else {
                    info.put("maxLevel", 1);
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
                ret.put("id", currentCid);
                ret.put("status", "PWM ON (" + (int) (intensity * 100) + "%)");
                call.resolve(ret);
            } else {
                isRunningPWM = false;
                pwmHandler.removeCallbacksAndMessages(null);

                if (intensity == null || intensity <= 0) {
                    cameraManager.setTorchMode(currentCid, false);
                } else {
                    cameraManager.setTorchMode(currentCid, true);
                }

                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("id", currentCid);
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
                try {
                    if (currentOnTime > 0) {
                        cm.setTorchMode(currentCid, true);
                        Thread.sleep(Math.max(1, currentOnTime));
                    }
                    if (currentOnTime < PWM_PERIOD) {
                        cm.setTorchMode(currentCid, false);
                        Thread.sleep(Math.max(1, PWM_PERIOD - currentOnTime));
                    }
                    if (isRunningPWM)
                        pwmHandler.post(this);
                } catch (Exception e) {
                    if (isRunningPWM)
                        pwmHandler.post(this);
                }
            }
        });
    }

    @PluginMethod
    public void deepScan(PluginCall call) {
        CameraManager cameraManager = (CameraManager) getContext().getSystemService(Context.CAMERA_SERVICE);
        List<String> found = new ArrayList<>();
        for (int i = 0; i < 11; i++) {
            String id = String.valueOf(i);
            try {
                cameraManager.getCameraCharacteristics(id);
                found.add(id);
            } catch (Exception e) {
            }
        }
        scanResult = "IDs: " + String.join(", ", found);
        JSObject ret = new JSObject();
        ret.put("result", scanResult);
        call.resolve(ret);
    }
}
