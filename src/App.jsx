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
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, t);
    filter.connect(ctx.destination);

    const oscSnap = ctx.createOscillator();
    const gainSnap = ctx.createGain();
    oscSnap.type = 'triangle';
    oscSnap.frequency.setValueAtTime(1500, t);
    oscSnap.frequency.exponentialRampToValueAtTime(100, t + 0.01);
    gainSnap.gain.setValueAtTime(0.5, t);
    gainSnap.gain.exponentialRampToValueAtTime(0.01, t + 0.01);
    oscSnap.connect(gainSnap);
    gainSnap.connect(filter);
    oscSnap.start(t);
    oscSnap.stop(t + 0.02);

    const oscThud = ctx.createOscillator();
    const gainThud = ctx.createGain();
    oscThud.type = 'square';
    oscThud.frequency.setValueAtTime(60, t);
    gainThud.gain.setValueAtTime(0.4, t);
    gainThud.gain.exponentialRampToValueAtTime(0.01, t + 0.04);
    oscThud.connect(gainThud);
    gainThud.connect(filter);
    oscThud.start(t);
    oscThud.stop(t + 0.06);

    const node = document.getElementById('haptic-visualizer');
    if (node) {
      node.style.opacity = '1';
      node.style.transform = 'scale(2)';
      setTimeout(() => {
        node.style.opacity = '0.1';
        node.style.transform = 'scale(1)';
      }, 80);
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
      forceLevel: forcedLevel
    }).then(res => {
      setNativeResult(`ID:${res.id} ${res.status}`);
      setLastError(null);
    }).catch(err => {
      setNativeResult(`FAIL`);
      setLastError(err.message);
    });

    const level = Math.ceil(val / 20);
    setActiveStep(level);
  };

  const runDeepScan = async () => {
    try {
      const res = await IntensityControl.deepScan();
      setNativeResult("SCAN DONE");
      const info = await IntensityControl.getFlashHardwareInfo();
      setHwData(info);
    } catch (err) {
      setLastError("Scan fail: " + err.message);
    }
  };

  useEffect(() => {
    const init = async () => {
      try {
        await IntensityControl.requestPermissions();
        const res = await IntensityControl.getFlashHardwareInfo();
        setHwData(res);
      } catch (err) {
        setLastError("Init fail: " + err.message);
      }
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
    const knob = knobRef.current;
    const track = trackRef.current;
    const container = document.getElementById('monolith-container');
    if (!knob || !track || !container) return;

    let isDragging = false;
    const handlePointerDown = (e) => {
      isDragging = true;
      knob.setPointerCapture(e.pointerId);
    };
    const handlePointerMove = (e) => {
      if (!isDragging) return;
      const rect = track.getBoundingClientRect();
      let y = e.clientY - rect.top;
      let p = 100 - (y / rect.height) * 100;
      updateIntensity(p);
    };
    const handlePointerUp = () => { isDragging = false; };

    container.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      container.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [mode]);

  useEffect(() => {
    if (mode !== 'dial') return;
    const dial = dialRef.current;
    if (!dial) return;

    let isDragging = false;
    const handlePointerDown = (e) => {
      isDragging = true;
      dial.setPointerCapture(e.pointerId);
    };
    const handlePointerMove = (e) => {
      if (!isDragging) return;
      const rect = dial.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const angle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180 / Math.PI;
      let normalized = (angle + 225) % 360;
      if (normalized > 270) normalized = normalized < 315 ? 270 : 0;
      const newVal = (normalized / 270) * 100;
      updateIntensity(newVal);
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
  }, [mode]);

  const intensityFloat = intensity / 100;
  const uiColor = priority => intensityFloat > 0.8 ? '#333' : '#fff';

  const beamStyle = {
    height: `${intensity}%`,
    background: intensity === 0 ? 'transparent' : '#fff',
    boxShadow: intensity === 0 ? 'none' : `0 0 20px rgba(255, 255, 255, ${intensityFloat})`
  };
  const knobStyle = { bottom: `${intensity}%` };
  const rotateDeg = 210 + (intensityFloat * 300);
  const dialStyle = { transform: `rotate(${rotateDeg}deg)` };
  const strokeOffset = TOTAL_ARC_LENGTH * (1 - intensityFloat);

  return (
    <>
      <header style={{ color: uiColor() }}>
        <div className="header-content">
          <div className="torch-icon">
            <svg viewBox="0 0 100 100" fill="currentColor">
              <g stroke="currentColor" strokeWidth="5" strokeLinecap="round">
                <line x1="30" y1="20" x2="20" y2="10" />
                <line x1="50" y1="15" x2="50" y2="5" />
                <line x1="70" y1="20" x2="80" y2="10" />
              </g>
              <path d="M35 35 L65 35 L60 50 L40 50 Z" />
              <rect x="42" y="50" width="16" height="35" rx="2" />
              <rect x="46" y="60" width="8" height="4" rx="1" fill="#0c0c0c" opacity="0.5" />
            </svg>
          </div>
          <div className="intensity-indicator">
            <div className="sun-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41" />
              </svg>
            </div>
            <div className="steps">
              {[1, 2, 3, 4, 5].map((level) => (
                <div
                  key={level}
                  className={`step ${level <= activeStep ? 'active' : ''}`}
                  data-level={level}
                  style={level <= activeStep ? { background: '#fff', boxShadow: '0 0 10px rgba(255,255,255,0.8)' } : { background: 'rgba(255,255,255,0.1)', boxShadow: 'none' }}
                />
              ))}
            </div>
            <div className="val-text" style={{ fontSize: '10px', marginLeft: '5px' }}>{intensity}% | {nativeResult}</div>
          </div>
          <div className="label">
            TORCH
            <div className="hw-debug" style={{ fontSize: '6.5px', opacity: 0.6, marginTop: '2px', lineHeight: '1.2' }}>
              {hwData ? (
                <>
                  {hwData.manufacturer} {hwData.model}<br />
                  {hwData.cameras.map(c => `C${c.id}:${c.maxLevel}`).join(' | ')}<br />
                  Status: <span style={{ color: hwData.torchStatus.includes('ON') ? '#00ff00' : '#fff' }}>{hwData.torchStatus}</span><br />
                  {hwData.scanResult && <div style={{ color: '#fff', fontSize: '6px' }}>{hwData.scanResult}</div>}
                </>
              ) : "Syncing... "}
            </div>
          </div>
        </div>
      </header>

      <main style={{ touchAction: 'none' }}>
        <div className={`concept-view ${mode === 'monolith' ? 'active' : ''}`} id="monolith-container" style={{ touchAction: 'none' }}>
          <div className="monolith-track" ref={trackRef}>
            <div className="beam" id="monolith-beam" style={beamStyle}></div>
            <div
              className="monolith-knob"
              id="monolith-knob"
              ref={knobRef}
              style={{ ...knobStyle, pointerEvents: 'auto', cursor: 'ns-resize' }}
            ></div>
          </div>
        </div>

        <div className={`concept-view ${mode === 'dial' ? 'active' : ''}`} id="dial-container">
          <div className="dial-wrapper">
            <svg className="dial-svg" viewBox="0 0 400 400">
              <defs>
                <filter id="arc-glow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="6" result="coloredBlur" />
                  <feMerge>
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <path
                d={`M ${200 + ARC_RADIUS * Math.cos((210 - 90) * Math.PI / 180)} ${200 + ARC_RADIUS * Math.sin((210 - 90) * Math.PI / 180)} A ${ARC_RADIUS} ${ARC_RADIUS} 0 1 1 ${200 + ARC_RADIUS * Math.cos((510 - 90) * Math.PI / 180)} ${200 + ARC_RADIUS * Math.sin((510 - 90) * Math.PI / 180)}`}
                fill="none"
                stroke="#000000"
                strokeWidth="14"
                strokeLinecap="round"
              />
              <path
                id="arc-fill"
                d={`M ${200 + ARC_RADIUS * Math.cos((210 - 90) * Math.PI / 180)} ${200 + ARC_RADIUS * Math.sin((210 - 90) * Math.PI / 180)} A ${ARC_RADIUS} ${ARC_RADIUS} 0 1 1 ${200 + ARC_RADIUS * Math.cos((510 - 90) * Math.PI / 180)} ${200 + ARC_RADIUS * Math.sin((510 - 90) * Math.PI / 180)}`}
                fill="none"
                stroke="#ffffff"
                strokeWidth="14"
                strokeLinecap="round"
                filter="url(#arc-glow)"
                strokeDasharray={TOTAL_ARC_LENGTH}
                strokeDashoffset={strokeOffset}
              />
            </svg>

            <div
              className="dial-outer"
              id="dial-outer"
              ref={dialRef}
              style={dialStyle}
            >
              <div className="dial-mark"></div>
            </div>
          </div>
          <div className="instruction">ROTATE</div>
        </div>
      </main>

      {/* ERROR CONSOLE */}
      {lastError && (
        <div style={{ position: 'fixed', top: '150px', background: 'rgba(255,0,0,0.8)', color: '#fff', fontSize: '10px', padding: '10px', width: '100%', zIndex: 10000 }}>
          {lastError}
        </div>
      )}

      {/* DEEP PROBE INTERFACE */}
      <div style={{ position: 'fixed', bottom: '110px', left: 0, right: 0, zIndex: 9999, display: 'flex', flexWrap: 'wrap', gap: '5px', padding: '10px', justifyContent: 'center', pointerEvents: 'auto', background: 'rgba(0,0,0,0.8)', borderTop: '1px solid #444' }}>
        <div style={{ color: '#fff', fontSize: '10px', width: '100%', textAlign: 'center', marginBottom: '5px' }}>
          TARGET ID: <input type="number" value={customId} onChange={e => setCustomId(e.target.value)} style={{ width: '40px', background: '#333', color: '#fff', border: '1px solid #555', padding: '2px', textAlign: 'center' }} />
          <button onClick={runDeepScan} style={{ marginLeft: '10px', background: '#007fff', color: '#fff', border: 'none', padding: '5px', borderRadius: '3px', fontSize: '9px' }}>RUN DEEP SCAN</button>
        </div>
        <div style={{ display: 'flex', gap: '5px' }}>
          <button onClick={() => updateIntensity(100, customId, 1)} style={{ background: '#444', color: '#fff', border: 'none', padding: '10px', borderRadius: '5px', fontSize: '10px' }}>FORCE L1</button>
          <button onClick={() => updateIntensity(100, customId, 10)} style={{ background: '#444', color: '#fff', border: 'none', padding: '10px', borderRadius: '5px', fontSize: '10px' }}>FORCE L10</button>
          <button onClick={() => updateIntensity(0)} style={{ background: '#222', color: '#fff', border: 'none', padding: '10px', borderRadius: '5px', fontSize: '10px' }}>OFF</button>
          <button onClick={() => updateIntensity(100, "0")} style={{ background: '#333', color: '#fff', border: 'none', padding: '10px', borderRadius: '5px', fontSize: '10px' }}>ID:0</button>
        </div>
      </div>

      <footer>
        <div className="interaction-group">
          <button
            className={`switcher-btn ${mode === 'monolith' ? 'active' : ''}`}
            data-mode="monolith"
            onClick={() => setMode('monolith')}
          >
            SLIDER
          </button>
          <div className="haptic-node" id="haptic-visualizer"></div>
          <button
            className={`switcher-btn ${mode === 'dial' ? 'active' : ''}`}
            data-mode="dial"
            onClick={() => setMode('dial')}
          >
            DIAL
          </button>
        </div>
      </footer>
    </>
  )
}

export default App
