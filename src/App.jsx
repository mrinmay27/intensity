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
  const [hwInfo, setHwInfo] = useState("Checking HW...")

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

  const updateIntensity = (val) => {
    val = Math.max(0, Math.min(100, Math.round(val)));
    setIntensity(val);
    playClick(val);

    // Hardware Control: Custom Native Intensity
    IntensityControl.setIntensity({ intensity: val / 100 }).catch(console.error);

    const level = Math.ceil(val / 20);
    setActiveStep(level);
  };

  useEffect(() => {
    // DIAGNOSTIC CORE: Tell us what the hardware actually sees
    IntensityControl.checkSupport().then(res => {
      setHwInfo(`Max Level: ${res.maxLevel || 1}`);
    }).catch(err => {
      setHwInfo("HW Check Failed");
    });
  }, []);

  useEffect(() => {
    if (mode !== 'monolith') return;
    const knob = knobRef.current;
    const track = trackRef.current;
    if (!knob || !track) return;

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

    const handlePointerUp = () => {
      isDragging = false;
    };

    knob.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      knob.removeEventListener('pointerdown', handlePointerDown);
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

    const handlePointerUp = () => {
      isDragging = false;
    };

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
  const uiColor = intensityFloat > 0.8 ? '#333' : '#fff';

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
      <header style={{ color: uiColor }}>
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
          </div>
          <div className="label">
            TORCH
            <div className="hw-debug" style={{ fontSize: '8px', opacity: 0.5, marginTop: '2px' }}>{hwInfo}</div>
          </div>
        </div>
      </header>

      <main>
        <div className={`concept-view ${mode === 'monolith' ? 'active' : ''}`} id="monolith-container">
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
