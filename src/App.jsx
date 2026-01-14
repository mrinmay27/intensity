import { useState, useRef, useEffect } from 'react'

// TOTAL_ARC_LENGTH constant for Dial SVG
const R = 158;
const TOTAL_ARC_LENGTH = (300 / 360) * (2 * Math.PI * R); // ~827.28

function App() {
  const [intensity, setIntensity] = useState(50)
  const [mode, setMode] = useState('dial') // 'dial' | 'monolith'
  const [activeStep, setActiveStep] = useState(3) // 50 / 20 rounded up roughly
  
  // Refs
  const audioCtxRef = useRef(null)
  const lastTickRef = useRef(-1)
  const dialRef = useRef(null)
  
  // Audio Engine: "Safe Dial" (Triangle Snap + Square Thud + Filter)
  const playClick = (val) => {
    // Initialize Audio Context on first interaction if needed
    if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();

    const currentFloor = Math.floor(val);
    if (currentFloor === lastTickRef.current) return;
    lastTickRef.current = currentFloor;

    const t = ctx.currentTime;

    // SHARED FILTER (Simulates heavy enclosure)
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, t);
    filter.connect(ctx.destination);
    
    // LAYER 1: The "Snap" (Trigger Mechanism)
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

    // LAYER 2: The "Thud" (Heavy Gear Weight)
    const oscThud = ctx.createOscillator();
    const gainThud = ctx.createGain();
    
    oscThud.type = 'square';
    oscThud.frequency.setValueAtTime(60, t); // Sub-bass weight
    
    gainThud.gain.setValueAtTime(0.4, t);
    gainThud.gain.exponentialRampToValueAtTime(0.01, t + 0.04);
    
    oscThud.connect(gainThud);
    gainThud.connect(filter);
    oscThud.start(t);
    oscThud.stop(t + 0.06);

    // Haptic Visualizer
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
      // Ensure integer
      val = parseInt(val, 10);
      setIntensity(val);
      playClick(val);
      
      // Calculate Active Step
      const level = Math.ceil(val / 20);
      setActiveStep(level === 0 ? 1 : level);
  };

  // Dial Interaction Logic
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
        e.preventDefault();
        
        const rect = dial.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        // Calculate angle
        const angle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180 / Math.PI;
        
        // Normalize to 0-360 range
        let normalized = (angle + 225) % 360;
        
        // Constrain rotation to avoid jumping at bottom gap
        if (normalized > 270) normalized = normalized < 315 ? 270 : 0;
        
        // Map to 0-100 intensity
        const newVal = Math.round((normalized / 270) * 100);
        updateIntensity(newVal);
     };

     const handlePointerUp = () => {
         isDragging = false;
     };

     dial.addEventListener('pointerdown', handlePointerDown);
     window.addEventListener('pointermove', handlePointerMove); // Listen on window for smooth drag
     window.addEventListener('pointerup', handlePointerUp);

     return () => {
         dial.removeEventListener('pointerdown', handlePointerDown);
         window.removeEventListener('pointermove', handlePointerMove);
         window.removeEventListener('pointerup', handlePointerUp);
     };
  }, [mode]); // Re-bind if mode changes (though logic mainly stays same)

  // Derived Styles
  const intensityFloat = intensity / 100;
  const uiColor = intensityFloat > 0.8 ? '#333' : '#fff'; // Dynamic Contrast
  
  // Monolith Styles
  const beamStyle = {
      height: `${intensity}%`,
      background: intensity === 0 ? 'transparent' : '#fff',
      boxShadow: intensity === 0 ? 'none' : `0 0 20px rgba(255, 255, 255, ${intensityFloat})`
  };
  const knobStyle = { bottom: `${intensity}%` };

  // Dial Styles
  const rotateDeg = 210 + (intensityFloat * 300);
  const dialStyle = { transform: `rotate(${rotateDeg}deg)` };
  const strokeOffset = TOTAL_ARC_LENGTH * (1 - intensityFloat);

  return (
    <>
      <header style={{ color: uiColor }}>
        <div className="header-content">
          <div className="torch-icon">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 2h10v3H7zM8.5 6h7l-1 12H9.5zM12 19l-1 2h2l-1-2z" />
            </svg>
          </div>
          <div className="intensity-indicator">
            <div className="sun-icon">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="5" />
                <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
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
            <div className="label">INTENSITY</div>
          </div>
        </div>
      </header>

      <main>
        {/* MONOLITH VIEW */}
        <div className={`concept-view ${mode === 'monolith' ? 'active' : ''}`} id="monolith-container">
            <div className="monolith-track">
                <div className="beam" id="monolith-beam" style={beamStyle}></div>
                <input 
                    type="range" 
                    id="monolith-slider" 
                    min="0" max="100" 
                    value={intensity} 
                    onChange={(e) => updateIntensity(e.target.value)}
                />
                <div className="monolith-knob" id="monolith-knob" style={knobStyle}></div>
            </div>
        </div>

        {/* DIAL VIEW */}
        <div className={`concept-view ${mode === 'dial' ? 'active' : ''}`} id="dial-container">
            <div className="dial-wrapper">
                <svg className="dial-svg" viewBox="0 0 400 400">
                    <defs>
                        <linearGradient id="arcGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#fff" stopOpacity="0.8" />
                            <stop offset="100%" stopColor="#fff" stopOpacity="1" />
                        </linearGradient>
                    </defs>
                    {/* Background Track (Start 210, End 510, R=158) */}
                    <path 
                        d="M 113.19 287.0 A 158 158 0 1 1 294.94 279.0"
                        fill="none" 
                        stroke="#000000" 
                        strokeWidth="20" 
                        strokeLinecap="round"
                    />
                    {/* Fill Arc */}
                    <path 
                        id="arc-fill"
                        d="M 113.19 287.0 A 158 158 0 1 1 294.94 279.0"
                        fill="none" 
                        stroke="#ffffff" 
                        strokeWidth="12" 
                        strokeLinecap="round"
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
                className={`switcher-btn ${mode === 'dial' ? 'active' : ''}`} 
                data-mode="dial"
                onClick={() => setMode('dial')}
            >
                DIAL
            </button>
            
            <div className="haptic-node" id="haptic-visualizer"></div>
            
            <button 
                className={`switcher-btn ${mode === 'monolith' ? 'active' : ''}`} 
                data-mode="monolith"
                onClick={() => setMode('monolith')}
            >
                SLIDER
            </button>
        </div>
      </footer>
    </>
  )
}

export default App
