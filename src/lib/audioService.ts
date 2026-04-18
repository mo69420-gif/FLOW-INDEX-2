// Tactical Audio Engine for FlowIndex OS
// Procedural sound generation via Web Audio API

class AudioService {
  private ctx: AudioContext | null = null;
  private enabled: boolean = true;

  private initCtx() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  setEnabled(val: boolean) {
    this.enabled = val;
  }

  // Simple High-to-Low for Back
  playBackward() {
    if (!this.enabled) return;
    this.initCtx();
    const osc = this.ctx!.createOscillator();
    const gain = this.ctx!.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, this.ctx!.currentTime);
    osc.frequency.exponentialRampToValueAtTime(300, this.ctx!.currentTime + 0.1);

    gain.gain.setValueAtTime(0.05, this.ctx!.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx!.currentTime + 0.1);

    osc.connect(gain);
    gain.connect(this.ctx!.destination);

    osc.start();
    osc.stop(this.ctx!.currentTime + 0.1);
  }

  // Simple Low-to-High for Forward
  playForward() {
    if (!this.enabled) return;
    this.initCtx();
    const osc = this.ctx!.createOscillator();
    const gain = this.ctx!.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, this.ctx!.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, this.ctx!.currentTime + 0.1);

    gain.gain.setValueAtTime(0.05, this.ctx!.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx!.currentTime + 0.1);

    osc.connect(gain);
    gain.connect(this.ctx!.destination);

    osc.start();
    osc.stop(this.ctx!.currentTime + 0.1);
  }

  // Short crisp click for Selection
  playSelect() {
    if (!this.enabled) return;
    this.initCtx();
    const osc = this.ctx!.createOscillator();
    const gain = this.ctx!.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(1000, this.ctx!.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, this.ctx!.currentTime + 0.05);

    gain.gain.setValueAtTime(0.03, this.ctx!.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx!.currentTime + 0.05);

    osc.connect(gain);
    gain.connect(this.ctx!.destination);

    osc.start();
    osc.stop(this.ctx!.currentTime + 0.05);
  }

  // Keep warning for critical actions
  playWarning() {
    if (!this.enabled) return;
    this.initCtx();
    const osc = this.ctx!.createOscillator();
    const gain = this.ctx!.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, this.ctx!.currentTime);
    osc.frequency.setValueAtTime(120, this.ctx!.currentTime + 0.15);

    gain.gain.setValueAtTime(0.04, this.ctx!.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx!.currentTime + 0.2);

    osc.connect(gain);
    gain.connect(this.ctx!.destination);

    osc.start();
    osc.stop(this.ctx!.currentTime + 0.2);
  }

  startHum() {
    if (!this.enabled) return null;
    this.initCtx();
    const osc = this.ctx!.createOscillator();
    const gain = this.ctx!.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(55, this.ctx!.currentTime);
    
    const lfo = this.ctx!.createOscillator();
    const lfoGain = this.ctx!.createGain();
    lfo.frequency.value = 5;
    lfoGain.gain.value = 1.5;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    gain.gain.setValueAtTime(0, this.ctx!.currentTime);
    gain.gain.linearRampToValueAtTime(0.02, this.ctx!.currentTime + 0.5);

    osc.connect(gain);
    gain.connect(this.ctx!.destination);

    lfo.start();
    osc.start();

    return {
      stop: () => {
        gain.gain.linearRampToValueAtTime(0, this.ctx!.currentTime + 0.2);
        setTimeout(() => {
          osc.stop();
          lfo.stop();
        }, 200);
      }
    };
  }
}

export const audio = new AudioService();
