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
  const [burstMode, setBurstMode] = useState(false)
  const [usePWM, setUsePWM] = useState(false)

  const audioCtxRef = useRef(null)
  const lastTickRef = useRef(-1)
  const dialRef = useRef(null)
  const knobRef = useRef(null)
  const trackRef = useRef(null)

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

  const updateIntensity = (val, forcedId = null, forcedLevel = null) => {
    val = Math.max(0, Math.min(100, Math.round(val)));
    setIntensity(val);
    playClick(val);

    const targetId = forcedId || customId;

    IntensityControl.setIntensity({
      intensity: val / 100,
      cameraId: targetId,
      forceLevel: forcedLevel,
      burst: burstMode,
      usePWM: usePWM
    }).then(res => {
      setNativeResult(`${usePWM ? 'PWM' : (burstMode ? 'BURST' : `ID:${targetId}`)} ${res.status}`);
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

  useEffect(() => {
    if (mode !== 'monolith') return;
    const track = trackRef.current;
    if (!track) return;
    let isDragging = false;
    const handlePointerDown = () => { isDragging = true; };
    const handlePointerMove = (e) => {
      if (!isDragging) return;
      const rect = track.getBoundingClientRect();
      let p = 100 - ((e.clientY - rect.top) / rect.height) * 100;
      updateIntensity(p);
    };
    const handlePointerUp = () => { isDragging = false; };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => { window.removeEventListener('pointermove', handlePointerMove); window.removeEventListener('pointerup', handlePointerUp); };
  }, [mode, burstMode, usePWM]);

  useEffect(() => {
    if (mode !== 'dial') return;
    const dial = dialRef.current;
    if (!dial) return;
    let isDragging = false;
    const handlePointerDown = () => { isDragging = true; };
    const handlePointerMove = (e) => {
      if (!isDragging) return;
      const rect = dial.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const angle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180 / Math.PI;
      let normalized = (angle + 225) % 360;
      if (normalized > 270) normalized = normalized < 315 ? 270 : 0;
      updateIntensity((normalized / 270) * 100);
    };
    const handlePointerUp = () => { isDragging = false; };
    dial.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      dial.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [mode, burstMode, usePWM]);

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
              {hwData ? `${hwData.model} | ${hwData.torchStatus}` : "Syncing..."}
            </div>
          </div>
        </div>
      </header>

      <main style={{ touchAction: 'none' }}>
        <div className={`concept-view ${mode === 'monolith' ? 'active' : ''}`} id="monolith-container">
          <div className="monolith-track" ref={trackRef} onPointerDown={() => { }}>
            <div className="beam" style={{ height: `${intensity}%`, background: '#fff', boxShadow: `0 0 20px rgba(255, 255, 255, ${intensityFloat})` }}></div>
            <div className="monolith-knob" style={{ bottom: `${intensity}%` }}></div>
          </div>
        </div>
        <div className={`concept-view ${mode === 'dial' ? 'active' : ''}`} id="dial-container">
          <div className="dial-wrapper">
            <svg className="dial-svg" viewBox="0 0 400 400"><path d={`M ${200 + ARC_RADIUS * Math.cos((210 - 90) * Math.PI / 180)} ${200 + ARC_RADIUS * Math.sin((210 - 90) * Math.PI / 180)} A ${ARC_RADIUS} ${ARC_RADIUS} 0 1 1 ${200 + ARC_RADIUS * Math.cos((510 - 90) * Math.PI / 180)} ${200 + ARC_RADIUS * Math.sin((510 - 90) * Math.PI / 180)}`} fill="none" stroke="#000" strokeWidth="14" strokeLinecap="round" /><path id="arc-fill" d={`M ${200 + ARC_RADIUS * Math.cos((210 - 90) * Math.PI / 180)} ${200 + ARC_RADIUS * Math.sin((210 - 90) * Math.PI / 180)} A ${ARC_RADIUS} ${ARC_RADIUS} 0 1 1 ${200 + ARC_RADIUS * Math.cos((510 - 90) * Math.PI / 180)} ${200 + ARC_RADIUS * Math.sin((510 - 90) * Math.PI / 180)}`} fill="none" stroke="#fff" strokeWidth="14" strokeLinecap="round" strokeDasharray={TOTAL_ARC_LENGTH} strokeDashoffset={strokeOffset} /></svg>
            <div className="dial-outer" ref={dialRef} style={{ transform: `rotate(${210 + (intensityFloat * 300)}deg)` }} onPointerDown={() => { }}><div className="dial-mark"></div></div>
          </div>
        </div>
      </main>

      <div style={{ position: 'fixed', bottom: '110px', left: 0, right: 0, zIndex: 9999, display: 'flex', flexWrap: 'wrap', gap: '5px', padding: '10px', justifyContent: 'center', pointerEvents: 'auto', background: 'rgba(0,0,0,0.8)' }}>
        <div style={{ color: '#fff', fontSize: '10px', width: '100%', textAlign: 'center', marginBottom: '5px' }}>
          ID: <input type="number" value={customId} onChange={e => setCustomId(e.target.value)} style={{ width: '30px', background: '#333', color: '#fff', border: '1px solid #555' }} />
          <button onClick={() => setUsePWM(!usePWM)} style={{ marginLeft: '10px', background: usePWM ? '#00ff00' : '#444', color: '#fff', border: 'none', padding: '5px', borderRadius: '3px', fontSize: '9px' }}>PWM: {usePWM ? 'ON' : 'OFF'}</button>
          <button onClick={() => setBurstMode(!burstMode)} style={{ marginLeft: '5px', background: burstMode ? '#ff4444' : '#444', color: '#fff', border: 'none', padding: '5px', borderRadius: '3px', fontSize: '9px' }}>BURST: {burstMode ? 'ON' : 'OFF'}</button>
        </div>
        <button onClick={() => updateIntensity(20)} style={{ background: '#444', color: '#fff', border: 'none', padding: '10px', borderRadius: '5px', fontSize: '8px' }}>20%</button>
        <button onClick={() => updateIntensity(50)} style={{ background: '#444', color: '#fff', border: 'none', padding: '10px', borderRadius: '5px', fontSize: '8px' }}>50%</button>
        <button onClick={() => updateIntensity(100)} style={{ background: '#444', color: '#fff', border: 'none', padding: '10px', borderRadius: '5px', fontSize: '8px' }}>100%</button>
        <button onClick={() => updateIntensity(0)} style={{ background: '#222', color: '#fff', border: 'none', padding: '10px', borderRadius: '5px', fontSize: '8px' }}>OFF</button>
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
