import { useState, useRef, useEffect } from 'react'
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { registerPlugin } from '@capacitor/core';

// Native Bridge for Granular Dimming
const IntensityControl = registerPlugin('IntensityControl');

// TOTAL_ARC_LENGTH constant for Dial SVG
const ARC_RADIUS = 170;
const TOTAL_ARC_LENGTH = 2 * Math.PI * ARC_RADIUS * (300 / 360);

function App() {
  const [intensity, setIntensity] = useState(0)
  const [mode, setMode] = useState('monolith')
  const [activeStep, setActiveStep] = useState(0)
  const [hwData, setHwData] = useState(null)
  const [lastError, setLastError] = useState(null)
  const [nativeResult, setNativeResult] = useState("Off")
  const [customId, setCustomId] = useState("0")
  const [usePWM, setUsePWM] = useState(false)
  const [showDump, setShowDump] = useState(false)
  const [charDump, setCharDump] = useState([])

  const audioCtxRef = useRef(null)
  const lastTickRef = useRef(-1)
  const dialRef = useRef(null)
  const trackRef = useRef(null)
  const isDraggingRef = useRef(false)

  const playClick = async (val) => {
    Haptics.impact({ style: ImpactStyle.Light });
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();
    const currentFloor = Math.floor(val);
    if (currentFloor === lastTickRef.current) return;
    lastTickRef.current = currentFloor;
    const t = ctx.currentTime;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.setValueAtTime(800, t); filter.connect(ctx.destination);

    const oscSnap = ctx.createOscillator(); const gainSnap = ctx.createGain();
    oscSnap.type = 'triangle'; oscSnap.frequency.setValueAtTime(1500, t); oscSnap.frequency.exponentialRampToValueAtTime(100, t + 0.01);
    gainSnap.gain.setValueAtTime(0.5, t); gainSnap.gain.exponentialRampToValueAtTime(0.01, t + 0.01);
    oscSnap.connect(gainSnap); gainSnap.connect(filter); oscSnap.start(t); oscSnap.stop(t + 0.02);

    const node = document.getElementById('haptic-visualizer');
    if (node) {
      node.style.opacity = '1'; node.style.transform = 'scale(2)';
      setTimeout(() => { node.style.opacity = '0.1'; node.style.transform = 'scale(1)'; }, 80);
    }
  };

  const updateIntensity = (val, forcedId = null) => {
    val = Math.max(0, Math.min(100, Math.round(val)));
    setIntensity(val);
    playClick(val);

    const targetId = forcedId || customId;

    IntensityControl.setIntensity({
      intensity: val / 100,
      cameraId: targetId,
      usePWM: usePWM
    }).then(res => {
      setNativeResult(`${res.status}`);
      setLastError(null);
    }).catch(err => {
      setNativeResult(`FAIL`);
      setLastError(err.message);
    });

    const level = Math.ceil(val / 20);
    setActiveStep(level);
  };

  useEffect(() => {
    const init = async () => {
      try {
        await IntensityControl.requestPermissions();
        const res = await IntensityControl.getFlashHardwareInfo();
        setHwData(res);
      } catch (err) { setLastError("Init fail: " + err.message); }
    };
    init();
    const interval = setInterval(async () => {
      try {
        const res = await IntensityControl.getFlashHardwareInfo();
        setHwData(res);
      } catch (e) { }
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // ROBUST GESTURE LOGIC using Global Window Listeners
  useEffect(() => {
    const handleGlobalMove = (e) => {
      if (!isDraggingRef.current) return;

      if (mode === 'monolith' && trackRef.current) {
        const rect = trackRef.current.getBoundingClientRect();
        let p = 100 - ((e.clientY - rect.top) / rect.height) * 100;
        updateIntensity(p);
      } else if (mode === 'dial' && dialRef.current) {
        const rect = dialRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const angle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180 / Math.PI;
        let normalized = (angle + 225) % 360;
        if (normalized > 270) normalized = normalized < 315 ? 270 : 0;
        updateIntensity((normalized / 270) * 100);
      }
    };

    const handleGlobalUp = () => {
      isDraggingRef.current = false;
    };

    window.addEventListener('pointermove', handleGlobalMove);
    window.addEventListener('pointerup', handleGlobalUp);
    return () => {
      window.removeEventListener('pointermove', handleGlobalMove);
      window.removeEventListener('pointerup', handleGlobalUp);
    };
  }, [mode, usePWM, customId]);

  const handlePointerDown = (e) => {
    isDraggingRef.current = true;
    // Trigger initial update on touch down
    if (mode === 'monolith' && trackRef.current) {
      const rect = trackRef.current.getBoundingClientRect();
      let p = 100 - ((e.clientY - rect.top) / rect.height) * 100;
      updateIntensity(p);
    } else if (mode === 'dial' && dialRef.current) {
      const rect = dialRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const angle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180 / Math.PI;
      let normalized = (angle + 225) % 360;
      if (normalized > 270) normalized = normalized < 315 ? 270 : 0;
      updateIntensity((normalized / 270) * 100);
    }
  };

  const runDump = async () => {
    try {
      const res = await IntensityControl.dumpAllCharacteristics({ cameraId: customId });
      setCharDump(res.data);
      setShowDump(true);
    } catch (err) { setLastError(err.message); }
  };

  const intensityFloat = intensity / 100;
  const strokeOffset = TOTAL_ARC_LENGTH * (1 - intensityFloat);

  return (
    <>
      <header style={{ color: intensityFloat > 0.8 ? '#333' : '#fff' }}>
        <div className="header-content">
          <div className="torch-icon">
            <svg viewBox="0 0 100 100" fill="currentColor"><path d="M35 35 L65 35 L60 50 L40 50 Z" /><rect x="42" y="50" width="16" height="35" rx="2" /></svg>
          </div>
          <div className="intensity-indicator">
            <div className="steps">
              {[1, 2, 3, 4, 5].map((level) => (<div key={level} className={`step ${level <= activeStep ? 'active' : ''}`} style={level <= activeStep ? { background: '#fff', boxShadow: '0 0 10px rgba(255,255,255,0.8)' } : { background: 'rgba(255,255,255,0.1)' }} />))}
            </div>
            <div className="val-text" style={{ fontSize: '10px', marginLeft: '5px' }}>{intensity}% | {nativeResult}</div>
          </div>
          <div className="label">
            TORCH
            <div className="hw-debug" style={{ fontSize: '6px', opacity: 0.6 }}>
              {hwData ? `${hwData.model} | HW: ${hwData.torchStatus}` : "Syncing..."}
            </div>
          </div>
        </div>
      </header>

      {showDump && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.95)', color: '#00ff00', zIndex: 11000, padding: '20px', overflowY: 'auto', fontSize: '10px', fontFamily: 'monospace' }}>
          <button onClick={() => setShowDump(false)} style={{ background: '#ff4444', color: '#fff', border: 'none', padding: '10px', marginBottom: '10px', borderRadius: '5px' }}>CLOSE DUMP</button>
          {charDump.map((line, i) => <div key={i} style={{ marginBottom: '4px', borderBottom: '1px solid #111' }}>{line}</div>)}
        </div>
      )}

      <main style={{ touchAction: 'none' }}>
        <div className={`concept-view ${mode === 'monolith' ? 'active' : ''}`}>
          <div
            className="monolith-track"
            ref={trackRef}
            onPointerDown={handlePointerDown}
            style={{ touchAction: 'none' }}
          >
            <div
              className="beam"
              style={{
                height: `${intensity}%`,
                background: '#fff',
                boxShadow: `0 0 20px rgba(255, 255, 255, ${intensityFloat})`,
                pointerEvents: 'none'
              }}
            ></div>
            <div
              className="monolith-knob"
              style={{ bottom: `${intensity}%`, pointerEvents: 'none' }}
            ></div>
          </div>
        </div>

        <div className={`concept-view ${mode === 'dial' ? 'active' : ''}`}>
          <div className="dial-wrapper">
            <svg className="dial-svg" viewBox="0 0 400 400" style={{ pointerEvents: 'none' }}>
              <path d={`M ${200 + ARC_RADIUS * Math.cos((210 - 90) * Math.PI / 180)} ${200 + ARC_RADIUS * Math.sin((210 - 90) * Math.PI / 180)} A ${ARC_RADIUS} ${ARC_RADIUS} 0 1 1 ${200 + ARC_RADIUS * Math.cos((510 - 90) * Math.PI / 180)} ${200 + ARC_RADIUS * Math.sin((510 - 90) * Math.PI / 180)}`} fill="none" stroke="#000" strokeWidth="14" strokeLinecap="round" /><path id="arc-fill" d={`M ${200 + ARC_RADIUS * Math.cos((210 - 90) * Math.PI / 180)} ${200 + ARC_RADIUS * Math.sin((210 - 90) * Math.PI / 180)} A ${ARC_RADIUS} ${ARC_RADIUS} 0 1 1 ${200 + ARC_RADIUS * Math.cos((510 - 90) * Math.PI / 180)} ${200 + ARC_RADIUS * Math.sin((510 - 90) * Math.PI / 180)}`} fill="none" stroke="#fff" strokeWidth="14" strokeLinecap="round" strokeDasharray={TOTAL_ARC_LENGTH} strokeDashoffset={strokeOffset} /></svg>
            <div
              className="dial-outer"
              ref={dialRef}
              onPointerDown={handlePointerDown}
              style={{ transform: `rotate(${210 + (intensityFloat * 300)}deg)`, touchAction: 'none' }}
            >
              <div className="dial-mark" style={{ pointerEvents: 'none' }}></div>
            </div>
          </div>
        </div>
      </main>

      <div style={{ position: 'fixed', bottom: '110px', left: 0, right: 0, zIndex: 9999, display: 'flex', flexWrap: 'wrap', gap: '5px', padding: '10px', justifyContent: 'center', pointerEvents: 'auto', background: 'rgba(0,0,0,0.8)' }}>
        <div style={{ color: '#fff', fontSize: '9px', width: '100%', textAlign: 'center', marginBottom: '5px' }}>
          ID: <input type="number" value={customId} onChange={e => setCustomId(e.target.value)} style={{ width: '30px', background: '#333', color: '#fff', border: '1px solid #555' }} />
          <button onClick={() => setUsePWM(!usePWM)} style={{ marginLeft: '10px', background: usePWM ? '#00ff00' : '#444', color: '#fff', border: 'none', padding: '4px 8px', borderRadius: '3px', fontSize: '9px' }}>PWM: {usePWM ? 'ON' : 'OFF'}</button>
          <button onClick={runDump} style={{ marginLeft: '5px', background: '#007fff', color: '#fff', border: 'none', padding: '4px 8px', borderRadius: '3px', fontSize: '9px' }}>DUMP PROPS</button>
        </div>
        <button onClick={() => updateIntensity(20)} style={{ background: '#444', color: '#fff', border: 'none', padding: '12px', borderRadius: '5px', fontSize: '10px' }}>20%</button>
        <button onClick={() => updateIntensity(50)} style={{ background: '#444', color: '#fff', border: 'none', padding: '12px', borderRadius: '5px', fontSize: '10px' }}>50%</button>
        <button onClick={() => updateIntensity(100)} style={{ background: '#444', color: '#fff', border: 'none', padding: '12px', borderRadius: '5px', fontSize: '10px' }}>100%</button>
        <button onClick={() => updateIntensity(0)} style={{ background: '#222', color: '#fff', border: 'none', padding: '12px', borderRadius: '5px', fontSize: '10px' }}>OFF</button>
        {hwData?.scanResult && <div style={{ fontSize: '6px', color: '#888', width: '100%', textAlign: 'center' }}>{hwData.scanResult}</div>}
      </div>

      <footer>
        <div className="interaction-group">
          <button className={`switcher-btn ${mode === 'monolith' ? 'active' : ''}`} onClick={() => setMode('monolith')}>SLIDER</button>
          <div className="haptic-node" id="haptic-visualizer"></div>
          <button className={`switcher-btn ${mode === 'dial' ? 'active' : ''}`} onClick={() => setMode('dial')}>DIAL</button>
        </div>
      </footer>
    </>
  )
}

export default App
