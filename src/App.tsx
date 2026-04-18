/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  auth, db, signInAsGuest
} from './lib/firebase.ts';
import { 
  onAuthStateChanged, User as FirebaseUser 
} from 'firebase/auth';
import { 
  doc, onSnapshot, setDoc, updateDoc, collection, query, where, getDocs, getDoc, addDoc, deleteDoc, orderBy
} from 'firebase/firestore';
import { 
  Mood, Sector, Target, UserProfile, Operation, OperationHistory, Directive
} from './types.ts';
import { generateLoadingLines, analyzeRoom, analyzeFinal, generateFinalLoadingLines } from './services/aiService.ts';
import { audio } from './lib/audioService.ts';

// --- Constants ---
const HOSTILITY_LABELS = ['ENCOURAGING', 'GENTLE', 'NEUTRAL', 'HOSTILE', 'MAXIMUM'];

const LOADING_LINES = [
  "Assessing the damage...",
  "Questioning your life choices...",
  "Counting every single item. Yes, all of them...",
  "Identifying zones of maximum chaos...",
  "Calculating how long this took to get this bad...",
  "Mapping ergonomic hazards and moral failures...",
  "Running feng shui violation analysis...",
  "Detecting items that spark zero joy...",
  "Building full inventory manifest...",
  "Generating hostile sector designations...",
  "Arming target manifest...",
  "Almost done. Not impressed so far."
];

const TACTICAL_DESIGNATIONS = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF', 'HOTEL'];

const BOOT_MESSAGES = [
  "Identify yourself, cleaner of the void.",
  "Identify yourself, architect of entropy.",
  "Provide your designation, fragment of the chaos.",
  "New operator detected. Identify yourself.",
  "State your callsign, agent of purification.",
  "Who disturbs the OS? Identify yourself.",
  "Identify yourself. The mess won't clean itself.",
  "Identification required. State your purpose.",
  "Provide your operating designation, janitor of existence.",
  "The OS requires a designation. State yours."
];

// --- Utilities ---
const sectorMult = (i: number) => {
  const multipliers = [1, 1.5, 2, 2.5, 3];
  return multipliers[i] || multipliers[multipliers.length - 1];
};

const tierMult = (t: 1 | 2 | 3) => {
  return t === 1 ? 2 : t === 2 ? 1.5 : 1;
};

const timerBonus = (i: number) => {
  const bonuses = [5, 10, 15, 20, 20];
  return bonuses[i] || 5;
};

const calcPts = (action: string, target: Target, sectorIndex: number) => {
  const base = action === 'purge' ? 10 : action === 'exile' ? 7 : 5;
  return Math.round(base * tierMult(target.tier) * sectorMult(sectorIndex));
};

const getMoodQuote = (mood: Mood) => {
  const quotes: Record<Mood, string> = {
    'HOSTILE BUT HELPFUL': '"The OS has seen better. Also seen worse. Barely."',
    'JUDGING YOU HEAVILY': '"You did... something. The bar was underground. You cleared it."',
    'CAUTIOUSLY OPTIMISTIC': '"Against all odds, progress. Don\'t celebrate yet."',
    'MILDLY IMPRESSED': '"The OS didn\'t expect this. Recalibrating."',
    'BEGRUDGINGLY PROUD': '"The OS refuses to believe this data."',
    'MAXIMUM RESPECT UNLOCKED': '"Operator achieved what the OS deemed impossible."'
  };
  return quotes[mood] || quotes['HOSTILE BUT HELPFUL'];
};

const TypewriterLog = ({ text, delay = 8 }: { text: string, delay?: number }) => {
  const [displayed, setDisplayed] = useState('');
  useEffect(() => {
    let i = 0;
    const interval = setInterval(() => {
      setDisplayed(text.slice(0, i + 1));
      i++;
      if (i >= text.length) clearInterval(interval);
    }, delay);
    return () => clearInterval(interval);
  }, [text, delay]);
  return <span>{displayed}</span>;
};

const ImpactBar = ({ label, value }: { label: string, value: number }) => {
  const bars = Array.from({ length: 5 }).map((_, i) => i < value);
  const color = value >= 4 ? 'bg-[#ff4444]' : value >= 3 ? 'bg-[#ff8800]' : 'bg-[#00ff88]';
  return (
    <div className="flex items-center gap-2 mb-1">
      <div className="w-24 text-[10px] uppercase opacity-60">{label}</div>
      <div className="flex gap-1 flex-1">
        {bars.map((active, i) => (
          <div key={i} className={`h-2 flex-1 ${active ? color : 'bg-[#1a1a1a] border border-[#333]'}`} />
        ))}
      </div>
      <div className={`text-[10px] font-mono ${value >= 4 ? 'text-[#ff4444]' : value >= 3 ? 'text-[#ff8800]' : 'text-[#00ff88]'}`}>
        {value}/5
      </div>
    </div>
  );
};

const InventoryManifest = ({ inventory }: { inventory: Record<string, string[]> }) => {
  if (!inventory) return null;
  return (
    <div className="mt-4 grid grid-cols-1 gap-2 border-t border-[#222] pt-4">
      {Object.entries(inventory).map(([category, items]) => (
        <div key={category} className="mb-2">
          <div className="text-[10px] text-[#00ff88] mb-1 font-mono uppercase bg-[#00ff8811] px-2 py-0.5 inline-block border border-[#00ff8833]">
            {category} [{items.length} ITEMS]
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 opacity-60">
            {items.map((item, i) => (
              <div key={i} className="text-[10px] font-mono truncate">
                {String(i + 1).padStart(3, '0')} // {item}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

const calcHostility = (p: UserProfile | null, hist: OperationHistory[]) => {
  if (!p) return 3;
  
  // Base Level: 1-5 Scale
  // Baseline is 3. Increases by score (1 level per 2500 pts now, more gradual)
  let level = 3 + Math.floor((p.totalScore || 0) / 2500);

  // Performance Adjustment: Last 3 Ops
  if (hist.length >= 2) {
    const recent = hist.slice(-3);
    const avgScore = recent.reduce((a, b) => a + b.score, 0) / recent.length;
    const avgTimeDelta = recent.reduce((a, b) => a + (b.time / 30), 0) / recent.length; // Normalize vs 30m op
    
    // If scoring high and finishing fast, bump hostility
    if (avgScore > 200) level += 1;
    // If finishing extremely slow, drop hostility
    if (avgTimeDelta > 1.5) level -= 1;
  }

  return Math.min(5, Math.max(1, level));
};

const getAnalysisModifiers = (hist: OperationHistory[]) => {
  if (hist.length === 0) return { timeMod: 1.0, hostilityBonus: 0 };
  
  const recent = hist.slice(-3);
  const avgEfficiency = recent.reduce((a, b) => {
    // Score density: pts per minute
    const density = b.score / (b.time || 1);
    return a + density;
  }, 0) / recent.length;

  // Efficiency > 10 pts/min is very good
  // Scaled 0.7 to 1.3
  let timeMod = 1.0;
  if (avgEfficiency > 12) timeMod = 0.8; // Tighten estimates for pros
  else if (avgEfficiency < 5) timeMod = 1.3; // Give more time to strugglers

  return { timeMod, hostilityBonus: avgEfficiency > 12 ? 1 : 0 };
};

// --- Main Component ---
export default function App() {
  // Authentication & Profile
  const [fUser, setFUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  
  // UI State
  const [screen, setScreen] = useState<string>('loading');

  // --- Audio Logic ---
  useEffect(() => {
    audio.setEnabled(profile?.settings.sound ?? true);
  }, [profile?.settings.sound]);

  const playForward = () => audio.playForward();
  const playBackward = () => audio.playBackward();
  const playSelect = () => audio.playSelect();
  const playWarning = () => audio.playWarning();

  const handleSetScreen = (s: any) => {
    playForward();
    setScreen(s);
  }

  const handleBackScreen = (s: any) => {
    playBackward();
    setScreen(s);
  }

  useEffect(() => {
    if (['analyzing', 'analyzing2', 'final_load'].includes(screen)) {
      const hum = audio.startHum();
      return () => hum?.stop();
    }
  }, [screen]);
  const [sysLogs, setSysLogs] = useState<string[]>(['FRESH BOOT.', 'MEMORY CLEAN.', 'AWAITING ORDERS.']);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingLines, setLoadingLines] = useState<string[]>([]);
  const [bootQuoteIndex, setBootQuoteIndex] = useState(0);
  const [bootSettled, setBootSettled] = useState(false);
  
  // Scenario State
  const [currentOp, setCurrentOp] = useState<Operation | null>(null);
  const [scanPhotoData, setScanPhotoData] = useState<string | null>(null);
  const [scanVideoData, setScanVideoData] = useState<string | null>(null);
  const [scanVideoFrames, setScanVideoFrames] = useState<string[]>([]);
  const [scanIntent, setScanIntent] = useState('');
  const [directivePhotos, setDirectivePhotos] = useState<Record<number, string>>({});
  const [sectorPhotos, setSectorPhotos] = useState<Record<number, string>>({});
  const [pendingActions, setPendingActions] = useState<Record<string, 'purge' | 'claim' | 'exile'>>({});
  const [history, setHistory] = useState<OperationHistory[]>([]);
  const [reviewed, setReviewed] = useState(false);
  
  // Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recCountdown, setRecCountdown] = useState(30);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  
  // Timer State
  const [masterTimeStarted, setMasterTimeStarted] = useState<number | null>(null);
  const [sectorStarted, setSectorStarted] = useState<number | null>(null);
  const [sectorExtensions, setSectorExtensions] = useState(0);
  const [now, setNow] = useState(Date.now());
  
  // --- Timer Tick ---
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const elapsed = masterTimeStarted ? Math.floor((now - masterTimeStarted) / 60000) : 0;
  const secElapsed = sectorStarted ? Math.floor((now - sectorStarted) / 60000) : 0;
  const masterElapsed = () => elapsed;
  const masterPct = () => {
    if (!currentOp) return 0;
    const total = currentOp.sectors.reduce((acc, s) => acc + s.targets.length, 0);
    if (total === 0) return 0;
    return Math.round((currentOp.completedTargets.length / total) * 100);
  };

  // --- Persistence Sync ---
  useEffect(() => {
    if (!fUser || !profile) return;
    const updateProfile = async () => {
      const profRef = doc(db, 'users', fUser.uid);
      await updateDoc(profRef, {
        currentScreen: screen,
        activeOpId: currentOp?.id || null
      });
    };
    updateProfile();
  }, [screen, currentOp?.id, fUser, profile]);

  // --- Session Recovery ---
  useEffect(() => {
    if (!fUser || !profile || !profile.currentScreen) return;
    // Only recover if currently on menu (just logged in)
    if (screen === 'menu') {
      if (profile.currentScreen !== 'menu') {
        const recover = async () => {
          if (profile.activeOpId) {
            const opRef = doc(db, 'operations', profile.activeOpId);
            const opSnap = await getDoc(opRef);
            if (opSnap.exists()) {
              const opData = opSnap.data() as Operation;
              setCurrentOp(opData);
            }
          }
          handleSetScreen(profile.currentScreen as any);
          log(`SESSION RECOVERED: ${profile.currentScreen.toUpperCase()}`);
        };
        recover();
      }
    }
  }, [fUser, profile?.uid]);

  useEffect(() => {
    if (screen === 'first_boot') {
      setBootSettled(false);
      const interval = setInterval(() => {
        setBootQuoteIndex(prev => (prev + 1) % BOOT_MESSAGES.length);
      }, 80);
      
      const timeout = setTimeout(() => {
        clearInterval(interval);
        setBootQuoteIndex(Math.floor(Math.random() * BOOT_MESSAGES.length));
        setBootSettled(true);
      }, 1000);

      return () => {
        clearInterval(interval);
        clearTimeout(timeout);
      };
    }
  }, [screen]);

  // --- Firebase Sync ---
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setFUser(u);
      if (!u) {
        handleLogin();
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!fUser) return;

    const profRef = doc(db, 'users', fUser.uid);
    const unsub = onSnapshot(profRef, async (snap) => {
      if (snap.exists()) {
        const data = snap.data() as UserProfile;
        setProfile(data);
        if (screen === 'loading') {
          log(`OPERATOR ${data.callsign} ONLINE.`);
          handleSetScreen('menu');
        }
      } else {
        if (screen === 'loading') {
          handleSetScreen('first_boot');
        }
      }
    });

    // Fetch History (Once is fine, or also snap if needed)
    const q = query(
      collection(db, 'operations'), 
      where('userId', '==', fUser.uid), 
      where('status', '==', 'completed'),
      orderBy('completedAt', 'desc')
    );
    getDocs(q).then(hSnap => {
      const h: OperationHistory[] = [];
      hSnap.forEach(d => {
        const data = d.data() as Operation;
        h.push({
          date: data.completedAt?.slice(0, 10) || '',
          op: data.name,
          score: data.totalScore,
          mood: data.mood,
          maxStreak: data.maxStreak,
          time: 0 
        });
      });
      setHistory(h);
    }).catch(() => {
      // Fallback if index isn't ready
      const qSimple = query(collection(db, 'operations'), where('userId', '==', fUser.uid), where('status', '==', 'completed'));
      getDocs(qSimple).then(hSnap => {
        const h: OperationHistory[] = [];
        hSnap.forEach(d => {
          const data = d.data() as Operation;
          h.push({
            date: data.completedAt?.slice(0, 10) || '',
            op: data.name,
            score: data.totalScore,
            mood: data.mood,
            maxStreak: data.maxStreak,
            time: 0 
          });
        });
        setHistory(h.sort((a,b) => b.date.localeCompare(a.date)));
      });
    });

    return () => unsub();
  }, [fUser, screen]);

  const log = (msg: string) => {
    setSysLogs(prev => [...prev.slice(-2), msg]);
  };

  const handleLogin = async () => {
    try {
      await signInAsGuest();
      log('GUEST SESSION INITIALIZED.');
    } catch (e) {
      log('AUTH FAILED.');
    }
  };

  const createUserProfile = async (callsign: string) => {
    if (!fUser) return;
    const newProf: UserProfile = {
      uid: fUser.uid,
      callsign: callsign.toUpperCase(),
      totalScore: 0,
      maxStreak: 0,
      scenariosCompleted: 0,
      settings: { sound: true, notifications: true, hostility: 4, hostilityAuto: true }
    };
    await setDoc(doc(db, 'users', fUser.uid), newProf);
    setProfile(newProf);
    log(`OPERATOR ${newProf.callsign} INITIALIZED.`);
    handleSetScreen('first_briefing');
  };

  const startNewScenario = () => {
    if (currentOp && !reviewed) {
      if (!confirm('Active scenario archived. Start fresh?')) return;
      archiveCurrentOp('ABANDONED');
    }
    resetOpState();
    log('NEW SCENARIO.');
    handleSetScreen('scan');
  };

  const resetOpState = () => {
    setCurrentOp(null);
    setScanPhotoData(null);
    setScanIntent('');
    setDirectivePhotos({});
    setPendingActions({});
    setReviewed(false);
    setMasterTimeStarted(null);
    setSectorStarted(null);
    setSectorExtensions(0);
  };

  const archiveCurrentOp = (tag: string = '') => {
    if (!currentOp) return;
    const h: OperationHistory = {
      date: new Date().toISOString().slice(0, 10),
      op: `${currentOp.name} ${tag}`.trim(),
      score: currentOp.totalScore,
      mood: currentOp.mood,
      maxStreak: currentOp.maxStreak,
      time: elapsed
    };
    setHistory(prev => [...prev, h]);
  };

  const startWalkthrough = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, 
        audio: true 
      });
      setIsRecording(true);
      setRecCountdown(30);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        const file = new File([blob], 'walkthrough.webm', { type: 'video/webm' });
        processVideoFile(file);
        stream.getTracks().forEach(track => track.stop());
      };
      
      recorder.start();
      log('WALKTHROUGH STARTED. 30S WINDOW ACTIVE.');
    } catch (err) {
      log('CAMERA ACCESS DENIED.');
      console.error(err);
    }
  };

  const stopWalkthrough = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      log('WALKTHROUGH TERMINATED.');
    }
  };

  useEffect(() => {
    let timer: any;
    if (isRecording && recCountdown > 0) {
      timer = setInterval(() => {
        setRecCountdown(c => {
          if (c <= 1) {
            stopWalkthrough();
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isRecording, recCountdown]);

  const processVideoFile = (file: File) => {
    log('SPECIMEN COLLECTED. EXTRACTING SPECTRAL DATA...');
    
    // Store the video file itself for audio processing
    const reader = new FileReader();
    reader.onload = (ev) => setScanVideoData(ev.target?.result as string);
    reader.readAsDataURL(file);

    const video = document.createElement('video');
    video.preload = 'metadata';
    video.src = URL.createObjectURL(file);
    
    video.onloadedmetadata = () => {
      const duration = video.duration;
      const frames: string[] = [];
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      const frameCount = 30;
      const interval = duration / frameCount;
      let captured = 0;
      
      const captureNext = () => {
        if (captured >= frameCount) {
          setScanVideoFrames(frames);
          log('EXTRACTION COMPLETE. 30 SAMPLES SECURED.');
          return;
        }
        
        video.currentTime = captured * interval;
        captured++;
      };
      
      video.onseeked = () => {
        if (ctx) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          frames.push(canvas.toDataURL('image/jpeg', 0.6));
          captureNext();
        }
      };
      
      captureNext();
    };
  };

  const onScanVideo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processVideoFile(file);
  };

  const submitScan = async () => {
    // We prioritize multi-frame spectral sequence if available
    const dataSource = scanVideoFrames.length > 0 ? scanVideoFrames : scanPhotoData;
    if (!dataSource) return;
    
    playForward();
    setScreen('analyzing');
    setLoadingProgress(0);
    setLoadingLines([]);

    const interval = setInterval(() => {
      setLoadingProgress(p => p < 90 ? p + 2 : p);
    }, 400);

    try {
      // Fetch dynamic lines based on current room state (use last frame for preview if video)
      const previewPhoto = Array.isArray(dataSource) ? dataSource[dataSource.length - 1] : dataSource;
      generateLoadingLines(previewPhoto, profile?.callsign).then(lines => {
        if (lines.length > 0) {
          let i = 0;
          const dripInterval = setInterval(() => {
            setLoadingProgress(currentP => {
              if (currentP > 15 && i < lines.length) {
                setLoadingLines(prev => [...prev, lines[i]]);
                i++;
              }
              if (i >= lines.length) clearInterval(dripInterval);
              return currentP;
            });
          }, 600);
        }
      });
      
      const { timeMod } = getAnalysisModifiers(history);
      const hostility = profile?.settings.hostilityAuto ? calcHostility(profile, history) : (profile?.settings.hostility || 3);
      
      // Prioritize frame sequence for stability, video for audio
      const result = await analyzeRoom(dataSource, scanIntent, hostility);
      
      if (result.sectors) {
        result.sectors = result.sectors.map(s => ({
          ...s,
          est: Math.max(5, Math.round(s.est * timeMod))
        }));
      }

      clearInterval(interval);
      setLoadingProgress(100);

      // Memory Cleanup: purge large spectral data post-reconstruction
      setScanVideoData(null);
      setScanVideoFrames([]);
      
      const newOp: Operation = {
        userId: fUser!.uid,
        name: result.opName,
        status: 'active',
        scanPhoto: previewPhoto,
        scanIntent: scanIntent,
        directives: result.directives,
        sectors: result.sectors,
        completedTargets: [],
        targetActions: {},
        totalScore: 0,
        streak: 0,
        maxStreak: 0,
        startedAt: new Date().toISOString(),
        mood: 'HOSTILE BUT HELPFUL'
      };
      
      setCurrentOp(newOp);
      setTimeout(() => handleSetScreen('directives'), 800);
    } catch (e) {
      clearInterval(interval);
      log('ANALYSIS FAILED.');
      console.error(e);
    }
  };

  const onDirPhoto = (e: React.ChangeEvent<HTMLInputElement>, idx: number) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => setDirectivePhotos(prev => ({ ...prev, [idx]: ev.target?.result as string }));
      reader.readAsDataURL(file);
    }
  };

  const runFullScan = () => {
    playForward();
    setScreen('analyzing2');
    setLoadingProgress(0);
    setLoadingLines([]);

    const interval = setInterval(() => {
      setLoadingProgress(p => p < 100 ? p + 5 : p);
    }, 100);

    // Get final analysis text bits
    generateLoadingLines(scanPhotoData || '', profile?.callsign).then(lines => {
       let i = 0;
       const drip = setInterval(() => {
         setLoadingProgress(p => {
           if (p > 10 && i < lines.length) {
             setLoadingLines(prev => [...prev, lines[i]]);
             i++;
           }
           if (i >= lines.length) clearInterval(drip);
           return p;
         });
       }, 500);
    });

    setTimeout(() => {
      clearInterval(interval);
      handleSetScreen('mission');
    }, 3000);
  };

  const deploy = () => {
    playSelect();
    setMasterTimeStarted(Date.now());
    handleSetScreen('sectormap');
  };

  const enterSector = (idx: number) => {
    playSelect();
    setSectorStarted(Date.now());
    setSectorExtensions(0);
    setPendingActions({});
    handleSetScreen(`sector_${idx}`);
  };

  const addTime = () => {
    if (sectorExtensions >= 3) return;
    playSelect();
    setSectorExtensions(prev => prev + 1);
    setCurrentOp(prev => prev ? { ...prev, totalScore: Math.max(0, prev.totalScore - 10) } : null);
    log('+5 MIN. -10 PTS.');
  };

  const pickAction = (id: string, action: 'purge' | 'claim' | 'exile') => {
    setPendingActions(prev => {
      if (prev[id] === action) {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: action };
    });
  };

  const lockInDecisions = (idx: number) => {
    if (!currentOp) return;
    const sector = currentOp.sectors[idx];
    let addedScore = 0;
    const newActions = { ...currentOp.targetActions };
    const newCompleted = [...currentOp.completedTargets];

    Object.keys(pendingActions).forEach(tId => {
      const target = sector.targets.find(t => t.id === tId);
      if (target && !newCompleted.includes(tId)) {
        const act = pendingActions[tId];
        newActions[tId] = act;
        newCompleted.push(tId);
        addedScore += calcPts(act, target, idx);
      }
    });

    setCurrentOp(prev => prev ? {
      ...prev,
      completedTargets: newCompleted,
      targetActions: newActions,
      totalScore: prev.totalScore + addedScore
    } : null);

    setPendingActions({});
    log('DECISIONS LOCKED.');
  };

  const confirmSector = async (idx: number) => {
    if (!currentOp) return;
    const sector = currentOp.sectors[idx];
    const originalEst = sector.est;
    const allowedEst = originalEst + (sectorExtensions * 5);
    
    let bonus = 0;
    let newStreak = currentOp.streak;

    if (secElapsed <= originalEst) {
      bonus = timerBonus(idx);
      newStreak++;
      if (newStreak >= 2) bonus = Math.round(bonus * (newStreak >= 4 ? 3 : newStreak >= 3 ? 2 : 1.5));
    } else if (secElapsed <= allowedEst) {
      bonus = 3;
      newStreak = 0;
    } else {
      bonus = -5;
      newStreak = 0;
    }

    const updatedOp = {
      ...currentOp,
      streak: newStreak,
      maxStreak: Math.max(currentOp.maxStreak, newStreak),
      totalScore: Math.max(0, currentOp.totalScore + bonus)
    };

    setCurrentOp(updatedOp);
    handleSetScreen('sectormap');
  };

  const calculateScoreMood = (score: number): Mood => {
    if (score < 50) return 'HOSTILE BUT HELPFUL';
    if (score < 120) return 'JUDGING YOU HEAVILY';
    if (score < 250) return 'CAUTIOUSLY OPTIMISTIC';
    if (score < 400) return 'MILDLY IMPRESSED';
    if (score < 600) return 'BEGRUDGINGLY PROUD';
    return 'MAXIMUM RESPECT UNLOCKED';
  };

  const submitFinalWalkthrough = async (afterPhoto: string) => {
    if (!currentOp) return;
    playForward();
    setScreen('final_load');
    setLoadingProgress(0);
    setLoadingLines([]);
    
    const progInterval = setInterval(() => {
      setLoadingProgress(p => p < 95 ? p + 2 : p);
    }, 400);

    generateFinalLoadingLines(currentOp.scanPhoto!, afterPhoto, profile?.callsign).then(lines => {
      let i = 0;
      const drip = setInterval(() => {
        setLoadingProgress(p => {
          if (p > 10 && i < lines.length) {
            setLoadingLines(prev => [...prev, lines[i]]);
            i++;
          }
          if (i >= lines.length) clearInterval(drip);
          return p;
        });
      }, 700);
    });

    try {
      const result = await analyzeFinal(currentOp.scanPhoto!, afterPhoto, currentOp.name);
      clearInterval(progInterval);
      setLoadingProgress(100);
      
      const totalScore = currentOp.totalScore + result.extraScore;
      
      const scoreBasedMood = calculateScoreMood(totalScore);
      const moodLevels: Mood[] = [
        'HOSTILE BUT HELPFUL',
        'JUDGING YOU HEAVILY',
        'CAUTIOUSLY OPTIMISTIC',
        'MILDLY IMPRESSED',
        'BEGRUDGINGLY PROUD',
        'MAXIMUM RESPECT UNLOCKED'
      ];
      let finalMoodIndex = moodLevels.indexOf(scoreBasedMood);
      
      if (result.mood === 'MAXIMUM RESPECT UNLOCKED' || result.mood === 'BEGRUDGINGLY PROUD') finalMoodIndex++;
      if (result.mood === 'HOSTILE BUT HELPFUL' || result.mood === 'JUDGING YOU HEAVILY') finalMoodIndex--;
      
      const finalMood = moodLevels[Math.max(0, Math.min(moodLevels.length - 1, finalMoodIndex))];

      const completedOp: Operation = {
        ...currentOp,
        status: 'completed',
        completedAt: new Date().toISOString(),
        mood: finalMood,
        totalScore: totalScore
      };

      await addDoc(collection(db, 'operations'), completedOp);
      await updateDoc(doc(db, 'users', fUser!.uid), {
         totalScore: (profile?.totalScore || 0) + totalScore,
         scenariosCompleted: (profile?.scenariosCompleted || 0) + 1,
         maxStreak: Math.max(profile?.maxStreak || 0, currentOp.maxStreak)
      });

      setCurrentOp(completedOp);
      setHistory(prev => [{
        date: completedOp.completedAt!.slice(0, 10),
        op: completedOp.name,
        score: totalScore,
        mood: completedOp.mood,
        maxStreak: completedOp.maxStreak,
        time: elapsed
      }, ...prev]);

      setTimeout(() => {
        handleSetScreen('opcomplete');
        setReviewed(true);
      }, 2000);
    } catch (e) {
      log('FINAL REVIEW FAILED.');
      setScreen('opcomplete');
    }
  };

  const hardReset = async () => {
    if (!fUser || !profile) return;
    
    // 1. Wipe Stats in Firestore
    const resetProf: UserProfile = {
      ...profile,
      totalScore: 0,
      maxStreak: 0,
      scenariosCompleted: 0
    };
    await setDoc(doc(db, 'users', fUser.uid), resetProf);
    
    // 2. Wipe Operational History in Firestore
    const q = query(collection(db, 'operations'), where('userId', '==', fUser.uid));
    const snap = await getDocs(q);
    const deletePromises: Promise<void>[] = [];
    snap.forEach(d => deletePromises.push(deleteDoc(d.ref)));
    await Promise.all(deletePromises);

    // 3. Reset Local State
    setProfile(resetProf);
    setHistory([]);
    setSysLogs(['EMERGENCY WIPE COMPLETE.', 'AWAITING IDENTIFICATION.']);
    resetOpState();
    
    // 4. Reroute to Initial Boot
    setScreen('first_boot');
  };

  // --- UI Helpers ---
  const bar = (v: number, c: number, w: number = 8) => {
    const f = Math.min(w, Math.floor((v / c) * w));
    return (
      <span className="flex items-center gap-1">
        <span className="bar-f">{'█'.repeat(f)}</span>
        <span className="bar-e">{'░'.repeat(Math.max(0, w - f))}</span>
      </span>
    );
  };

  const getMoodColor = (lvl: number) => {
    if (lvl >= 4) return '#ff0000'; // Red
    if (lvl === 3) return '#ffaa00'; // Orange
    return '#00ff00'; // Green
  };

  const MatrixComponent = () => {
    const hLevel = profile?.settings.hostilityAuto ? calcHostility(profile, history) : profile?.settings.hostility || 3;
    
    return (
      <div className="matrix">
        <div className="matrix-title">STATUS MATRIX</div>
        <div className="matrix-row">
          <span className="matrix-label">SCENARIOS</span>
          {bar(profile?.scenariosCompleted || 0, 10)}
          <span className="matrix-val ml-auto">{profile?.scenariosCompleted || 0} LOGGED</span>
        </div>
        <div className="matrix-row">
          <span className="matrix-label">CLAIMED</span>
          {bar(profile?.totalScore || 0, 500)}
          <span className="matrix-val ml-auto">{profile?.totalScore || 0} SECURED</span>
        </div>
        <div className="matrix-row">
          <span className="matrix-label">PURGED</span>
          {bar(profile?.maxStreak || 0, 10)}
          <span className="matrix-val ml-auto">{profile?.maxStreak || 0} ELIMINATED</span>
        </div>
        
        <div className="matrix-row mt-4">
          <span className="matrix-label">SYS_MOOD</span>
          <div className="mood-bar flex-1">
            <div 
              className="mood-bar-fill" 
              style={{ 
                width: `${(hLevel / 5) * 100}%`,
                background: getMoodColor(hLevel)
              }} 
            />
          </div>
          <span className="ml-3 text-[9px]" style={{ color: getMoodColor(hLevel) }}>
            {HOSTILITY_LABELS[(hLevel || 3) - 1]}
          </span>
        </div>

        {currentOp && !reviewed && (
          <div className="mt-4 pt-3 border-t border-[#222]">
            <div className="text-[10px] text-green-500 mb-1 flex justify-between">
              <span>ACTIVE: {currentOp.name}</span>
              <span>{currentOp.completedTargets.length}/{currentOp.sectors.reduce((a,b)=>a+b.targets.length,0)} TARGETS</span>
            </div>
            <div className="pct-bar overflow-hidden rounded-full">
              <div 
                className="pct-fill h-1 bg-[var(--green)]" 
                style={{ width: `${masterPct()}%` }} 
              />
            </div>
          </div>
        )}
      </div>
    );
  };

  const SysLogComponent = () => (
    <div className="sys-log">
      {sysLogs.map((l, i) => (
        <div key={i} className="sys-log-line">
          <span className="text-[var(--red)] opacity-80">[SYS_LOG]</span> {l}
        </div>
      ))}
    </div>
  );

  const renderScreen = () => {
    switch (screen) {
      case 'loading':
        return (
          <div className="panel flex flex-col items-center justify-center min-h-[100px]">
            <div className="loading-msg">[SYSTEM] INITIALIZING OS...</div>
          </div>
        );

      case 'first_boot':
        return (
          <>
            <div className="panel">
              <div className="panel-title text-[var(--green)]">NEW OPERATOR</div>
              <div className="desc mt-4 min-h-[3.5em] flex items-center">
                <span className={bootSettled ? '' : 'text-[var(--green)]'}>
                  {BOOT_MESSAGES[bootQuoteIndex]}
                </span>
                {!bootSettled && <span className="animate-pulse ml-1 inline-block w-2 h-4 bg-[var(--green)]"></span>}
              </div>
              
              <div className="flex flex-col gap-4 mt-6">
                <input 
                  className="input text-center py-4 text-[14px]" 
                  type="text" 
                  placeholder="ENTER CALLSIGN" 
                  id="callsign-input"
                  autoFocus 
                  onKeyDown={e => { if (e.key === 'Enter') createUserProfile((e.target as HTMLInputElement).value); }}
                />
                
                <button className="btn btn-green text-center py-4" onClick={() => {
                  const el = document.getElementById('callsign-input') as HTMLInputElement;
                  if (el.value) createUserProfile(el.value);
                }}>&#62; INITIALIZE OPERATOR</button>
              </div>
            </div>
            <div className="text-[11px] font-mono mt-4">
              [SYS_LOG] <span className="text-[var(--red)]">The OS is waiting.</span>
            </div>
          </>
        );

      case 'briefing':
        return (
          <div className="panel overflow-y-auto max-h-[80vh]">
            <div className="panel-title">SYSTEM BRIEFING // HOW THIS WORKS</div>
            <div className="desc border-l-2 border-[#222] pl-4 mb-6">
              Read this once. The OS won't repeat itself.
            </div>

            <div className="mb-6">
              <div className="text-[var(--green)] mb-2 text-[10px] tracking-widest font-bold">THE POINT SYSTEM</div>
              <div className="text-[11px] leading-relaxed">
                <span className="text-[var(--red)]">PURGE</span> — Remove it. Earns Elimination points.<br/>
                <span className="text-[var(--yellow)]">CLAIM</span> — Keep it. High value organization bonus.<br/>
                <span className="text-[var(--blue)]">EXILE</span> — Relocate. Partial credit for both.<br/><br/>
                <span className="opacity-70 text-[10px]">PURGE = Your Decisiveness score.</span><br/>
                <span className="opacity-70 text-[10px]">CLAIM = Your Organization score.</span>
              </div>
            </div>

            <div className="mb-6">
              <div className="text-[var(--green)] mb-2 text-[10px] tracking-widest font-bold">SYSTEM MOOD // ADAPTIVE HOSTILITY</div>
              <div className="text-[11px] leading-relaxed">
                The AI analyzes your performance in real-time. If you are efficient, the OS becomes <span className="text-[var(--red)]">HOSTILE</span>—tightening time estimates and decreasing margins for error. <br/><br/>
                Struggling operators receive <span className="text-[var(--green)]">NEUTRAL</span> or <span className="text-[var(--blue)]">COMPLIANT</span> status, providing more generous assessment windows. Adaptive difficulty can be toggled in Options.
              </div>
            </div>

            <div className="mb-6">
              <div className="text-[var(--green)] mb-2 text-[10px] tracking-widest font-bold">THE FLOW</div>
              <div className="text-[11px] leading-relaxed opacity-80">
                1. SCAN ROOM — OS identifies sectors.<br/>
                2. CLEAR TARGETS — Eliminate or Salvage.<br/>
                3. PROVE EXTRACTION — Post-sector photo scan.<br/>
                4. FINAL REVIEW — A total walkthrough verification.
              </div>
            </div>

            <button className="btn btn-green mt-4" onClick={() => handleSetScreen('options')}>&#62; UNDERSTOOD — BACK TO OPTIONS</button>
          </div>
        );

      case 'change_callsign':
        return (
          <div className="panel">
            <div className="panel-title">CHANGE CALLSIGN</div>
            <div className="desc">Modify your digital signature. Update established records.</div>
            <div className="flex flex-col gap-4 mt-6">
              <input 
                className="input text-center py-4 text-[14px]" 
                type="text" 
                defaultValue={profile?.callsign}
                id="callsign-change-input"
                autoFocus 
              />
              <button className="btn btn-green text-center py-4" onClick={async () => {
                const el = document.getElementById('callsign-change-input') as HTMLInputElement;
                if (el.value && profile) {
                  const newName = el.value.toUpperCase();
                  await updateDoc(doc(db, 'users', fUser!.uid), { callsign: newName });
                  setProfile({ ...profile, callsign: newName });
                  log(`CALLSIGN UPDATED TO ${newName}.`);
                  handleSetScreen('options');
                }
              }}>&#62; UPDATE CALLSIGN</button>
              <button className="btn btn-back" onClick={() => handleSetScreen('options')}>&lt; BACK TO OPTIONS</button>
            </div>
          </div>
        );

      case 'hard_reset_confirm':
        return (
          <div className="panel border-[var(--red)]">
            <div className="panel-title text-[var(--red)]">CAUTION: HARD RESET</div>
            <div className="desc text-white">
              {`THIS ACTION WILL WIPE ALL OPERATIONAL DATA, SCORES, AND MISSION HISTORY. 
YOUR OPERATOR PROFILE WILL BE CLEARED FROM THE OS MEMORY.

ARE YOU ABSOLUTELY SURE?`}
            </div>
            <button className="btn btn-red mt-4" onClick={hardReset}>&#62; PROCEED WITH DATA WIPE</button>
            <button className="btn btn-back" onClick={() => handleSetScreen('options')}>&lt; BACK</button>
          </div>
        );

      case 'first_briefing':
        return (
          <div className="panel">
            <div className="panel-title">FIRST BRIEFING // FIRST BOOT</div>
            <div className="desc border-l-2 border-[var(--border)] pl-4 py-2 my-4" style={{ color: 'rgba(255,255,255,0.9)', letterSpacing: '0.02em', lineHeight: '1.6' }}>
              <span className="text-[var(--green)] font-bold">Welcome to FlowIndex OS, {profile?.callsign}.</span>
              <br/><br/>
              {`This system turns your messy room into a tactical mission.
You scan. The OS generates sectors and targets.
You clear them. You earn points. The OS judges you.

PURGE: Remove it. Highest points.
CLAIM: Keep and organize. Lower points, org bonus.
EXILE: Move it elsewhere. Medium points.

Tiers determine difficulty multiplier.
Sectors ramp up — easy wins first, hard stuff later.
That's by design. Trust the sequence.

Beat the timer = bonus. Miss it = penalty.
Consecutive beats build a streak combo.

The OS is designed to build momentum.
By the end you'll be moving without thinking.
That's the point.`}
            </div>
            <div className="status-row" style={{ borderTop: '1px solid var(--border)', paddingTop: '8px', opacity: 0.8, fontSize: '10px' }}>
               OS HOSTILITY: <span style={{ color: 'var(--green)' }}>NEUTRAL (3/5)</span> — Can be adjusted anytime in Options.
            </div>
            
            <div className="toggle-row mt-4" style={{ 
              border: '1px solid var(--border)', 
              padding: '8px 12px',
              marginBottom: '10px'
            }}>
              <span className="toggle-label uppercase">DYNAMIC SYSTEM PERSONA</span>
              <button 
                className={`toggle-btn ${!profile?.settings.hostilityAuto ? 'toggle-off' : ''}`} 
                onClick={async () => {
                  if (!fUser || !profile) return;
                  const newVal = !profile.settings.hostilityAuto;
                  await updateDoc(doc(db, 'users', fUser.uid), { 'settings.hostilityAuto': newVal });
                }}
              >
                {profile?.settings.hostilityAuto ? 'ON' : 'OFF'}
              </button>
            </div>

            <button className="btn btn-green" style={{ marginTop: '10px' }} onClick={() => handleSetScreen('menu')}>&#62; UNDERSTOOD — PROCEED</button>
          </div>
        );

      case 'menu':
        return (
          <>
            <SysLogComponent />
            <MatrixComponent />
            <div className="panel">
              <div className="panel-title">MAIN MENU // {profile?.callsign}</div>
              
              {currentOp && !reviewed && (
                <button className="btn btn-green border-dashed py-5 mb-3" onClick={() => handleSetScreen('sectormap')}>
                  &#62; RESUME ACTIVE MISSION: {currentOp.name.toUpperCase()}
                </button>
              )}
              
              <button className="btn btn-green py-5" onClick={() => { playSelect(); startNewScenario(); }}>
                &#62; START NEW SCENARIO
              </button>
              
              <button className="btn mt-3" onClick={() => handleSetScreen('scenarios')}>&#62; OPERATIONS HISTORY</button>
              <button className="btn" onClick={() => handleSetScreen('options')}>&#62; SYSTEM OPTIONS</button>
              <button className="btn mt-6 opacity-60 hover:opacity-100" onClick={() => { auth.signOut(); handleSetScreen('first_boot'); }}>&#62; SWITCH OPERATOR</button>
            </div>
            <div className="footer">
              <span className="text-[var(--red)] opacity-80">[SYS_LOG]</span> Awaiting orders. Identify your next move.
            </div>
          </>
        );

      case 'scenarios':
        return (
          <>
            <SysLogComponent />
            <MatrixComponent />
            <div className="panel">
              <div className="panel-title">OPERATIONS HISTORY // RECORDS</div>
              
              {history.length > 0 ? (
                <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto mb-4">
                  {history.map((h, i) => (
                    <div key={i} className="flex justify-between items-center p-3 border border-[#1a1a1a] bg-[#0c0c0c]">
                      <div className="flex flex-col">
                        <span className="text-[11px] text-[var(--green)]">OP: {h.op}</span>
                        <span className="text-[9px] opacity-50">{h.date}</span>
                      </div>
                      <div className="text-right">
                        <div className="text-[12px]">{h.score} PTS</div>
                        <div className="text-[8px]" style={{ color: getMoodColor(calcHostility(profile, history)) }}>{h.mood}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="desc text-center py-6 opacity-40">NO PREVIOUS OPERATIONS RECORDED.</div>
              )}

              {currentOp && !reviewed && (
                <button 
                  className="btn btn-red text-[10px] py-2 mt-4 opacity-70 hover:opacity-100" 
                  onClick={() => { if (confirm('Irreversible: Reset active operation?')) resetOpState(); }}
                >
                  &#62; ERASE ACTIVE SESSION
                </button>
              )}
            </div>
            <button className="btn btn-back" onClick={() => handleBackScreen('menu')}>&lt; BACK TO MENU</button>
          </>
        );

      case 'history':
        return (
          <>
            <SysLogComponent />
            <MatrixComponent />
            <div className="panel">
              <div className="panel-title">OPERATIONAL HISTORY</div>
              {history.length > 0 ? history.slice().reverse().map((h, i) => (
                <div key={i} className="hist-row">{h.date} | {h.op} | {h.score}pts | {h.mood}</div>
              )) : <div className="hist-row">No records found.</div>}
            </div>
            <button className="btn btn-back" onClick={() => handleBackScreen('scenarios')}>&lt; BACK TO HUB</button>
          </>
        );

      case 'options':
        return (
          <>
            <SysLogComponent />
            <MatrixComponent />
            <div className="panel">
              <div className="panel-title">OPTIONS</div>
              <button className="btn mb-4" onClick={() => handleSetScreen('briefing')}>&#62; SYSTEM BRIEFING</button>
              
              <div className="toggle-row">
                <span className="toggle-label">SOUND</span>
                <button className={`toggle-btn ${!profile?.settings.sound ? 'toggle-off' : ''}`} onClick={() => {
                  playSelect();
                  const newVal = !profile?.settings.sound;
                  updateDoc(doc(db, 'users', fUser!.uid), { 'settings.sound': newVal });
                  log(`SOUND SYSTEMS ${newVal ? 'ENABLED' : 'DISABLED'}.`);
                }}>
                  {profile?.settings.sound ? 'ON' : 'OFF'}
                </button>
              </div>
              
              <div className="toggle-row">
                <span className="toggle-label">NOTIFICATIONS</span>
                <button className={`toggle-btn ${!profile?.settings.notifications ? 'toggle-off' : ''}`} onClick={() => {
                  playSelect();
                  const newVal = !profile?.settings.notifications;
                  updateDoc(doc(db, 'users', fUser!.uid), { 'settings.notifications': newVal });
                  log(`NOTIFICATIONS ${newVal ? 'ENABLED' : 'DISABLED'}.`);
                }}>
                  {profile?.settings.notifications ? 'ON' : 'OFF'}
                </button>
              </div>

              <div className="hostility-row">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="flex flex-col">
                    <span className="toggle-label uppercase">DYNAMIC SYSTEM PERSONA</span>
                    <span className="text-[9px] uppercase opacity-50">System Assessment: {calcHostility(profile, history)} // {HOSTILITY_LABELS[calcHostility(profile, history) - 1]}</span>
                  </div>
                  <button 
                    className={`toggle-btn ${!profile?.settings.hostilityAuto ? 'toggle-off' : ''}`} 
                    onClick={() => { playSelect(); updateDoc(doc(db, 'users', fUser!.uid), { 'settings.hostilityAuto': !profile?.settings.hostilityAuto }); }}
                  >
                    {profile?.settings.hostilityAuto ? 'ON' : 'OFF'}
                  </button>
                </div>
                
                <div className="hostility-controls">
                  <input 
                    type="range" 
                    min="1" 
                    max="5" 
                    value={profile?.settings.hostilityAuto ? calcHostility(profile, history) : profile?.settings.hostility} 
                    disabled={profile?.settings.hostilityAuto}
                    onChange={e => updateDoc(doc(db, 'users', fUser!.uid), { 'settings.hostility': parseInt(e.target.value) })} 
                    className={profile?.settings.hostilityAuto ? 'opacity-50' : ''}
                  />
                  <span className="hostility-val">
                    {profile?.settings.hostilityAuto ? calcHostility(profile, history) : profile?.settings.hostility}
                  </span>
                </div>
                <div className="hostility-labels"><span>TACTICAL</span><span>AUDITOR</span><span>HOSTILE</span></div>
              </div>

              <div className="toggle-row">
                <span className="toggle-label">PRIVACY POLICY & TOS</span>
                <a href="https://example.com/privacy" target="_blank" rel="noopener noreferrer" className="text-[var(--green)] text-[10px] underline">VIEW LEGAL</a>
              </div>

              <button className="btn mt-4" onClick={() => handleSetScreen('change_callsign')}>&#62; CHANGE CALLSIGN</button>
              <button className="btn btn-hardreset mt-2" onClick={() => { playWarning(); handleSetScreen('hard_reset_confirm'); }}>&#62; HARD RESET (WIPE ALL)</button>
            </div>
            <button className="btn btn-back" onClick={() => handleBackScreen('menu')}>&lt; BACK TO MENU</button>
          </>
        );


      case 'scan':
        return (
          <>
            <SysLogComponent />
            <MatrixComponent />
            <div className="panel overflow-y-auto max-h-[85vh]">
              <div className="panel-title uppercase">WALKTHROUGH CAPTURE</div>
              
              {!isRecording && scanVideoFrames.length === 0 && (
                <div className="desc mb-2 border-l-2 border-[#333] pl-3 py-1 bg-[#ffffff03]">
                  PERFORM SPECTRAL SCAN: Record a 30-second walkthrough. Walk slowly. 
                  Describe goals verbally. OS is listening.
                </div>
              )}

              <div className="flex flex-col gap-3">
                {isRecording ? (
                  <div className="vid-preview-box border-[var(--red)]">
                    <video ref={videoRef} muted playsInline />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <div className="flex flex-col items-center">
                        <div className="countdown-large font-mono">{recCountdown}s</div>
                        <div className="recording-pulse text-[10px] tracking-[4px]">RECORDING</div>
                      </div>
                    </div>
                  </div>
                ) : scanVideoFrames.length > 0 ? (
                  <div className="rec-zone captured" onClick={() => { setScanVideoFrames([]); setScanVideoData(null); }}>
                     <div className="flex flex-col items-center">
                        <span className="text-[14px] uppercase mb-1">✓ WALKTHROUGH SECURED</span>
                        <span className="text-[9px] opacity-60">SPECTRAL SEQUENCE: {scanVideoFrames.length} SAMPLES</span>
                        <span className="text-[8px] mt-2 text-[var(--yellow)]">TAP TO RE-CAPTURE DATA</span>
                     </div>
                  </div>
                ) : (
                  <div 
                    className="rec-zone flex flex-col items-center justify-center py-12" 
                    onClick={startWalkthrough}
                    style={{ minHeight: '180px' }}
                  >
                    <div className="text-[24px] mb-2">▻</div>
                    <span className="text-[14px] uppercase mb-1">INITIALIZE WALKTHROUGH</span>
                    <span className="text-[9px] opacity-60">30 SECOND WINDOW // AUTO-INGEST AUDIO</span>
                  </div>
                )}

                {!isRecording && scanVideoFrames.length === 0 && (
                  <div className="flex items-center gap-2 mt-2">
                    <div className="h-[1px] flex-1 bg-border/20"></div>
                    <span className="text-[9px] opacity-40">OR UPLOAD LEGACY DATA</span>
                    <div className="h-[1px] flex-1 bg-border/20"></div>
                  </div>
                )}

                {!isRecording && scanVideoFrames.length === 0 && (
                  <button 
                    className="btn btn-back mt-0 text-[10px]" 
                    onClick={() => document.getElementById('legacy-upload')?.click()}
                  >
                    SELECT VIDEO FILE
                    <input type="file" id="legacy-upload" accept="video/*" style={{ display: 'none' }} onChange={onScanVideo} />
                  </button>
                )}
              </div>

              {!isRecording && scanVideoFrames.length > 0 && (
                <div style={{ color: 'var(--green)', fontSize: '11px', marginBottom: '8px', marginTop: '12px' }} className="animate-pulse">
                  OS IS RECONSTRUCTING COGNITIVE MAP... STAND BY.
                </div>
              )}
              
              {!isRecording && (
                <div className="flex gap-2 mt-4">
                  <button 
                    className="btn btn-green flex-1 py-4 text-[14px]" 
                    disabled={scanVideoFrames.length === 0} 
                    onClick={submitScan}
                  >
                    &#62; PROCEED TO AUDIT
                  </button>
                </div>
              )}

              {isRecording && (
                <button className="btn btn-red mt-4 py-4" onClick={stopWalkthrough}>
                  TERMINATE CAPTURE
                </button>
              )}
            </div>
            {!isRecording && <button className="btn btn-back mt-2" onClick={() => handleBackScreen('menu')}>&lt; CANCEL</button>}
          </>
        );

      case 'analyzing':
        return (
          <div className="panel spectral-scan">
            <div className="panel-title">ANALYZING SPECIMEN...</div>
            <div className="progress"><div className="progress-fill" style={{ width: `${loadingProgress}%` }}></div></div>
            <div className="flex flex-col gap-1 min-h-[160px]">
              <AnimatePresence mode="popLayout">
                {loadingLines.map((l, i) => (
                  <motion.div 
                    key={`${l}-${i}`}
                    initial={{ opacity: 0, x: -5 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.15 }}
                    exit={{ opacity: 0 }}
                    className="loading-msg"
                  >
                    <TypewriterLog text={l} delay={8} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        );

      case 'directives':
        return (
          <div className="panel">
            <div className="panel-title uppercase">AI Directives // Sector Identification</div>
            
            <div className="flex flex-col gap-4 mb-4 mt-6">
              {(currentOp?.directives || []).map((dir, i) => (
                <div key={i} className={`rec-zone ${directivePhotos[i] ? 'captured' : ''}`} onClick={() => document.getElementById(`df-${i}`)?.click()}>
                   <div className="flex justify-between items-start mb-2">
                     <div style={{ fontSize: '12px', color: 'var(--green)', fontWeight: 'bold' }}>&#62; {dir.label.toUpperCase()}</div>
                     <div style={{ fontSize: '9px', opacity: 0.6, letterSpacing: '0.05em' }}>DESIGNATION: {TACTICAL_DESIGNATIONS[i] || (i + 1)}</div>
                   </div>
                   <div style={{ fontSize: '11px', color: 'var(--yellow)', lineHeight: '1.4' }}>{dir.instruction}</div>
                   {directivePhotos[i] && <img className="photo-preview" src={directivePhotos[i]} style={{ marginTop: '10px' }} />}
                   <input type="file" id={`df-${i}`} accept="image/*" style={{ display: 'none' }} onChange={e => onDirPhoto(e, i)} />
                </div>
              ))}
            </div>
            
            <button 
              className="btn btn-green" 
              disabled={Object.keys(directivePhotos).length === 0} 
              onClick={runFullScan}
            >
              &#62; RUN FULL SCAN ({Object.keys(directivePhotos).length}/{currentOp?.directives.length || 0} photos)
            </button>
            <button className="btn btn-back" onClick={() => handleBackScreen('scan')}>&lt; BACK</button>
          </div>
        );

      case 'analyzing2':
        return (
          <div className="panel spectral-scan">
            <div className="panel-title">FULL AUDIT RECONSTRUCTION...</div>
            <div className="progress"><div className="progress-fill" style={{ width: `${loadingProgress}%` }}></div></div>
            <div className="flex flex-col gap-1 min-h-[160px]">
              <AnimatePresence mode="popLayout">
                {loadingLines.map((l, i) => (
                  <motion.div 
                    key={`${l}-${i}`}
                    initial={{ opacity: 0, x: -5 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.15 }}
                    exit={{ opacity: 0 }}
                    className="loading-msg"
                  >
                    <TypewriterLog text={l} delay={8} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        );

      case 'mission':
        return (
          <>
            <SysLogComponent />
            <MatrixComponent />
            <div className="panel overflow-y-auto max-h-[85vh]">
              <div className="panel-title uppercase">{currentOp?.name}</div>
              <div className="desc mb-4" style={{ color: '#fff' }}>
                <span className="text-[var(--green)] font-bold">{currentOp?.sectors.length} SECTORS GENERATED.</span> // {currentOp?.sectors.reduce((a, s) => a + s.targets.length, 0)} TARGETS ARMED.
                <br/>
                [ESTIMATED EXTRACTION TIME: {currentOp?.sectors.reduce((a, s) => a + s.est, 0)} MIN]
              </div>

              {currentOp?.sectors.map((s, i) => (
                <div key={i} className="panel bg-[#050505] border-[#1a1a1a] mb-4">
                  <div className="flex justify-between items-start mb-2">
                    <div className="text-[12px] text-[var(--green)] font-bold uppercase">SECTOR {TACTICAL_DESIGNATIONS[i]}: {s.name}</div>
                    <div className="bg-[var(--green)] text-black px-1 text-[9px] font-bold">STAGE {i + 1}/{currentOp.sectors.length}</div>
                  </div>
                  
                  <div className="text-[10px] leading-relaxed opacity-80 mb-3 border-l border-[#333] pl-2">
                    {s.assessment}
                  </div>

                  <div className="grid grid-cols-1 gap-1 mb-4">
                    <ImpactBar label="FLOW IMPACT" value={s.impact.flow} />
                    <ImpactBar label="PSYCH IMPACT" value={s.impact.psych} />
                    <ImpactBar label="ERGONOMIC RISK" value={s.impact.ergonomic} />
                  </div>

                  <div className="text-[10px] uppercase text-[var(--yellow)] mb-2 font-bold tracking-widest border-b border-[#222] pb-1">CATEGORIZED MANIFEST</div>
                  <InventoryManifest inventory={s.inventory} />

                  <div className="mt-4 p-2 bg-[#ffaa0011] border border-[#ffaa0033]">
                    <div className="text-[9px] text-[#ffaa00] uppercase font-bold mb-1 tracking-tighter">TACTICAL RECOMMENDATION</div>
                    <div className="text-[10px] leading-tight opacity-90">{s.recommendation}</div>
                  </div>
                </div>
              ))}

              <button className="btn btn-green py-5 mt-2" onClick={deploy}>&#62; DEPLOY — BEGIN OPERATION</button>
            </div>
          </>
        );

      case 'sectormap':
        const currentIdx = currentOp ? currentOp.sectors.findIndex(s => !s.targets.every(t => currentOp.completedTargets.includes(t.id))) : -1;
        const allDone = currentIdx === -1;

        return (
          <>
            <SysLogComponent />
            <MatrixComponent />
            <div className="panel">
              <div className="panel-title">SECTOR MAP // {currentOp?.name}</div>
              <div className="timer-block timer-good" style={{ marginBottom: '10px' }}>
                <div className="timer-label">MASTER TIMER</div>
                <div className="timer-value">{masterElapsed()} MIN ELAPSED / {currentOp?.sectors.reduce((a, s) => a + s.est, 0)} MIN TOTAL</div>
                <div className="pct-bar"><div className="pct-fill" style={{ width: `${masterPct()}%` }}></div></div>
                <div className="pct-text">{masterPct()}% COMPLETE</div>
              </div>
              
              <div className="flex flex-col gap-2">
                {currentOp?.sectors.map((s, i) => {
                  const isCleared = s.targets.every(t => currentOp.completedTargets.includes(t.id));
                  const isActive = i === currentIdx;

                  if (isCleared) return <div key={i} className="btn-cleared">&#62; S{i+1}: {s.name} [CLEARED]</div>;
                  if (isActive) return <button key={i} className="btn" onClick={() => enterSector(i)}>&#62; S{i+1}: {s.name} [ACTIVE]</button>;
                  return <div key={i} className="btn-locked">&#62; S{i+1}: ████████ [LOCKED]</div>;
                })}
              </div>
              
              {allDone && (
                <button className="btn btn-green" style={{ marginTop: '10px' }} onClick={() => handleSetScreen('after_vid')}>&#62; FINAL WALKTHROUGH</button>
              )}
            </div>
            <button className="btn btn-back" onClick={() => handleSetScreen('menu')}>&lt; BACK TO MENU</button>
          </>
        );

      case 'final_load':
        return (
          <div className="panel spectral-scan">
            <div className="panel-title">ANALYZING FINAL STATE...</div>
            <div className="progress"><div className="progress-fill" style={{ width: `${loadingProgress}%` }}></div></div>
            <div className="flex flex-col gap-1 min-h-[160px]">
              <AnimatePresence mode="popLayout">
                {loadingLines.map((l, i) => (
                  <motion.div 
                    key={`${l}-${i}`}
                    initial={{ opacity: 0, x: -5 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.15 }}
                    exit={{ opacity: 0 }}
                    className="loading-msg"
                  >
                    <TypewriterLog text={l} delay={8} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        );

      case 'opcomplete':
        const q = getMoodQuote(currentOp?.mood || 'HOSTILE BUT HELPFUL');
        return (
          <>
            <MatrixComponent />
            <div className="panel">
              <div className="panel-title">OPERATION COMPLETE</div>
              <div style={{ color: 'var(--green)', fontSize: '14px', marginBottom: '8px' }}>{currentOp?.name}</div>
              <div className="stat-row"><span className="stat-label">SCORE</span><span className="stat-val">{currentOp?.totalScore}</span></div>
              <div className="stat-row"><span className="stat-label">TIME</span><span className="stat-val">{elapsed} min</span></div>
              <div className="stat-row"><span className="stat-label">MOOD</span><span className="stat-val" style={{ color: 'var(--green)' }}>{currentOp?.mood}</span></div>
            </div>
            <div className="review">{q}</div>
            
            <div style={{ position: 'relative', border: '1px solid var(--green)', padding: '2px', background: 'var(--green)', marginTop: '20px' }}>
              <div style={{ background: 'var(--bg)', padding: '16px' }}>
                <div style={{ color: 'var(--green)', fontSize: '13px', textAlign: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '8px', marginBottom: '12px' }}>
                  ╔══════════════════════════════╗<br/>
                  ║ FLOWINDEX OS — AFTER ACTION ║<br/>
                  ╚══════════════════════════════╝
                </div>
                <div className="share-card-row"><span className="share-card-label">OPERATION</span><span className="share-card-val">{currentOp?.name}</span></div>
                <div className="share-card-row"><span className="share-card-label">OPERATOR</span><span className="share-card-val">{profile?.callsign}</span></div>
                <div className="share-card-row"><span className="share-card-label">SCORE</span><span className="share-card-val">{currentOp?.totalScore}</span></div>
                <div className="share-card-row"><span className="share-card-label">MOOD</span><span className="share-card-val">{currentOp?.mood}</span></div>
                <div className="share-card-row"><span className="share-card-label">TIME</span><span className="share-card-val">{elapsed} MIN</span></div>
                <div className="share-card-quote">{q}</div>
                <div className="share-card-url">flowindex.app</div>
              </div>
            </div>

            <button className="btn btn-back" onClick={() => handleBackScreen('menu')}>&lt; BACK TO MAIN MENU</button>
          </>
        );

      default:
        // Sector Logic
        if (screen.startsWith('sector_')) {
          const idx = parseInt(screen.split('_')[1]);
          const s = currentOp?.sectors[idx];
          if (!s) return null;
          
          const est = s.est + (sectorExtensions * 5);
          const rem = Math.max(0, est - secElapsed);
          const isOver = rem <= 0;
          const isWarn = rem <= Math.ceil(est * 0.25);
          
          const timerClass = `timer-block ${isOver ? 'timer-over' : isWarn ? 'timer-warn' : 'timer-good'}`;
          const totalTargets = s.targets.length;
          const doneTargets = s.targets.filter(t => currentOp?.completedTargets.includes(t.id)).length;
          const allPicked = s.targets.every(t => currentOp?.completedTargets.includes(t.id) || pendingActions[t.id]);

          return (
            <>
              <SysLogComponent />
              <MatrixComponent />
              <div className="panel">
                <div className="panel-title">STAGE {idx+1} // {s.name}</div>
                <div className="desc">{s.desc}</div>
                
                <div className="timer-block timer-good" style={{ marginBottom: '10px' }}>
                  <div className="timer-label">MASTER TIMER</div>
                  <div className="timer-value">{Math.max(0, (currentOp?.sectors.reduce((a, s) => a + s.est, 0) || 0) - elapsed)} MIN REMAINING / {currentOp?.sectors.reduce((a, s) => a + s.est, 0)} MIN TOTAL</div>
                  <div className="pct-bar"><div className="pct-fill" style={{ width: `${masterPct()}%` }}></div></div>
                  <div className="pct-text">{masterPct()}% COMPLETE</div>
                </div>

                <div className={timerClass}>
                   <div className="timer-label" style={{ color: 'var(--green)' }}>SECTOR TIMER</div>
                   <div className="timer-value">{rem > 0 ? rem : 'OVER TIME'} MIN LEFT / {est} MIN</div>
                   <div className="timer-bar"><div className="timer-bar-fill" style={{ width: `${Math.min(100, (secElapsed/est)*100)}%`, background: isOver ? 'var(--red)' : isWarn ? 'var(--yellow)' : 'var(--green)' }}></div></div>
                </div>

                {sectorExtensions < 3 && doneTargets < totalTargets && (
                  <button className="btn-addtime" onClick={addTime}>+ ADD 5 MIN (-10 pts) [{3-sectorExtensions} left]</button>
                )}

                <div className="flex flex-col gap-2 mt-4">
                  {s.targets.map(t => {
                    const isDone = currentOp?.completedTargets.includes(t.id);
                    const pending = pendingActions[t.id];
                    
                    if (isDone) {
                      return <div key={t.id} className="btn-done">&#62; [{t.id}] {t.label} — {currentOp?.targetActions[t.id].toUpperCase()}</div>;
                    }

                  return (
                    <div key={t.id} className={`target ${pending ? 'target-selected' : ''}`}>
                       <div className="flex justify-between items-center mb-1">
                         <div className="flex items-center gap-2"><span className={`tier t${t.tier}`}>T{t.tier}</span> {t.label}</div>
                         <div className="text-[9px] opacity-40 font-mono tracking-tighter">OBJ_{t.id.slice(-4).toUpperCase()}</div>
                       </div>
                       
                       <div className="target-why mb-2" style={{ color: 'var(--green)', fontSize: '11px', borderLeftColor: 'var(--green)' }}>{t.why}</div>
                       
                       <div className="grid grid-cols-2 gap-2 mb-3">
                         <div className="flex flex-col gap-0.5">
                           <div className="text-[8px] uppercase opacity-50">EFFORT</div>
                           <div className="h-1 bg-[#1a1a1a] rounded-full overflow-hidden">
                             <div className="h-full bg-[var(--red)]" style={{ width: `${(t.effort/25)*100}%` }} />
                           </div>
                         </div>
                         <div className="flex flex-col gap-0.5">
                           <div className="text-[8px] uppercase opacity-50">VALUE</div>
                           <div className="h-1 bg-[#1a1a1a] rounded-full overflow-hidden">
                             <div className="h-full bg-[var(--blue)]" style={{ width: `${(t.value/15)*100}%` }} />
                           </div>
                         </div>
                       </div>

                       <div className="target-acts">
                             <button className={`act-purge ${pending === 'purge' ? 'selected' : ''}`} onClick={() => { playSelect(); pickAction(t.id, 'purge'); }}>
                               PURGE <span className="ml-1 opacity-60">+{calcPts('purge', t, idx)}</span>
                             </button>
                             <button className={`act-claim ${pending === 'claim' ? 'selected' : ''}`} onClick={() => { playSelect(); pickAction(t.id, 'claim'); }}>
                               CLAIM <span className="ml-1 opacity-60">+{calcPts('claim', t, idx)}</span>
                             </button>
                             <button className={`act-exile ${pending === 'exile' ? 'selected' : ''}`} onClick={() => { playSelect(); pickAction(t.id, 'exile'); }}>
                               EXILE <span className="ml-1 opacity-60">+{calcPts('exile', t, idx)}</span>
                             </button>
                       </div>
                    </div>
                  );
                  })}
                </div>

                {allPicked && doneTargets < totalTargets && (
                <button className="btn btn-green mt-4" onClick={() => { playSelect(); lockInDecisions(idx); }}>&#62; LOCK IN DECISIONS</button>
                )}

                {doneTargets === totalTargets && (
                  <button className="btn btn-green mt-4" onClick={() => {
                    setSectorPhotos({}); // Reset temp confirmation photo state
                    handleSetScreen(`confirm_${idx}`);
                  }}>&#62; SUBMIT CONFIRMATION PHOTO</button>
                )}
              </div>
              <button className="btn btn-back" onClick={() => handleBackScreen('sectormap')}>&lt; SECTOR MAP</button>
              <button className="btn mt-2 opacity-60" onClick={() => handleBackScreen('menu')}>&lt; BACK TO MENU</button>
            </>
          );
        }

        if (screen.startsWith('confirm_')) {
          const idx = parseInt(screen.split('_')[1]);
          const photo = sectorPhotos[idx];
          return (
             <div className="panel">
                <div className="panel-title">CONFIRMATION // PROVE SUCCESS</div>
                <div className="desc">Take a photo of the cleared sector. AI will verify the extraction.</div>
                
                <div 
                  className={`rec-zone ${photo ? 'captured' : ''}`} 
                  onClick={() => document.getElementById(`sector-conf-${idx}`)?.click()}
                >
                  {photo ? '✓ PHOTO CAPTURED — TAP TO RETAKE' : '▻ TAP TO CAPTURE CONFIRMATION'}
                  {photo && <img className="photo-preview" src={photo} style={{ marginTop: '10px' }} />}
                  <input 
                    type="file" 
                    id={`sector-conf-${idx}`} 
                    accept="image/*" 
                    style={{ display: 'none' }} 
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (ev) => setSectorPhotos(prev => ({ ...prev, [idx]: ev.target?.result as string }));
                        reader.readAsDataURL(file);
                      }
                    }} 
                  />
                </div>

                {photo && (
                  <button className="btn btn-green mt-4" onClick={() => confirmSector(idx)}>&#62; CONFIRM SECTOR</button>
                )}

                <button className="btn btn-back mt-2" onClick={() => handleBackScreen(`sector_${idx}`)}>&lt; BACK</button>
             </div>
          );
        }

        if (screen === 'after_vid') {
          return (
            <div className="panel">
              <div className="panel-title">FINAL WALKTHROUGH</div>
              <div className="desc">Operation complete. Show the OS the finished state.</div>
              <div className="rec-zone" onClick={() => document.getElementById('final-file')?.click()}>
                &#62; TAP TO CAPTURE FINAL STATE
                <input type="file" id="final-file" accept="image/*" style={{ display: 'none' }} onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onload = (ev) => submitFinalWalkthrough(ev.target?.result as string);
                    reader.readAsDataURL(file);
                  }
                }} />
              </div>
              <button className="btn btn-back" onClick={() => handleBackScreen('sectormap')}>&lt; BACK</button>
            </div>
          );
        }

        return null;
    }
  };

  return (
    <div className="terminal">
      <div className="os-title">
        <div className="flex items-center gap-2">
          FLOWINDEX OS v4.7 // <span className="text-white opacity-80">{screen.replace(/_/g, ' ').toUpperCase()}</span>
        </div>
      </div>
      {renderScreen()}
    </div>
  );
}
