package com.intensity.app;

import android.content.Context;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "IntensityControl")
public class IntensityControlPlugin extends Plugin {

    @PluginMethod
    public void setIntensity(PluginCall call) {
        Double intensity = call.getDouble("intensity", 1.0);
        Context context = getContext();
        CameraManager cameraManager = (CameraManager) context.getSystemService(Context.CAMERA_SERVICE);

        try {
            String cameraId = cameraManager.getCameraIdList()[0]; // Usually the back camera with flash

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                // Android 13+ native intensity control
                CameraCharacteristics characteristics = cameraManager.getCameraCharacteristics(cameraId);
                Integer maxLevel = characteristics.get(CameraCharacteristics.FLASH_INFO_STRENGTH_MAXIMUM_LEVEL);

                if (maxLevel != null && maxLevel > 1) {
                    // Calculate level based on percentage (1 to maxLevel)
                    int level = (int) Math.max(1, Math.round(intensity * maxLevel));
                    if (intensity == 0) {
                        cameraManager.setTorchMode(cameraId, false);
                    } else {
                        cameraManager.turnOnTorchWithStrengthLevel(cameraId, level);
                    }
                } else {
                    // Fallback to binary on/off if hardware doesn't support levels
                    cameraManager.setTorchMode(cameraId, intensity > 0);
                }
            } else {
                // Fallback for older Android versions
                cameraManager.setTorchMode(cameraId, intensity > 0);
            }
            call.resolve();
        } catch (CameraAccessException e) {
            call.reject("Camera access error", e);
        } catch (Exception e) {
            call.reject("Flashlight error", e);
        }
    }
}
