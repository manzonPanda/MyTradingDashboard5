import { Injectable } from '@angular/core';

export interface ConfettiConfig {
  duration?: number;
  particleCount?: number;
  text?: string;
  playSound?: boolean;
  showMusicControl?: boolean;
  dismissTextOnly?: boolean;
  colors?: string[];
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  rotationSpeed: number;
  color: string;
  size: number;
  gravity: number;
  life: number;
  maxLife: number;
  shape: 'square' | 'circle' | 'triangle';
}

@Injectable({
  providedIn: 'root'
})
export class ConfettiService {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private particles: Particle[] = [];
  private animationId: number | null = null;
  private audio: HTMLAudioElement | null = null;
  private readonly celebrationMusic = new Audio('/assets/sounds/profit-target-theme.mp3');
  private readonly payoutCelebrationMusic = new Audio('/assets/sounds/multo(cupOfJoe).mp3');
  private readonly payoutMusicEndedHandler = (): void => {
    this.removePayoutMusicNotification();
    this.stopCelebration();
  };
  private payoutMusicNotification: HTMLElement | null = null;
  private isPlaying = false;

  constructor() {
    this.payoutCelebrationMusic.addEventListener('ended', this.payoutMusicEndedHandler);
    this.initializeAudio();
  }

  private initializeAudio(): void {
    // Create audio context for celebration sounds
    try {
      this.audio = new Audio();
      // Using a simple oscillator-generated sound since we can't include external files
      this.createCelebrationSound();
    } catch (error) {
      console.warn('Audio not supported, confetti will play without sound');
    }
  }

  private createCelebrationSound(): void {
    if (!this.audio) return;
    
    // Create a data URL for a simple celebration sound
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    // Create a simple celebration tune
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    let noteIndex = 0;
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.setValueAtTime(notes[0], audioContext.currentTime);
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    
    // Create a cheerful melody
    notes.forEach((note, index) => {
      oscillator.frequency.setValueAtTime(note, audioContext.currentTime + index * 0.15);
    });
    
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.8);
    
    // Store for later use
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.8);
  }

  celebrate(config: ConfettiConfig = {}): void {
    if (this.isPlaying) return; // Prevent multiple celebrations at once

    const defaultConfig: Required<ConfettiConfig> = {
      duration: 0, // 0 means no auto-hide, display permanently
      particleCount: 800, // Massive confetti explosion!
      text: 'PROFIT TARGET REACHED!',
      playSound: true,
      showMusicControl: true,
      dismissTextOnly: false,
      colors: ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FECA57', '#FF9FF3', '#54A0FF', '#00D2D3', '#FF1744', '#76FF03', '#E91E63', '#9C27B0', '#673AB7']
    };

    const finalConfig = { ...defaultConfig, ...config };

    this.isPlaying = true;
    this.setupCanvas();
    this.createParticles(finalConfig.particleCount, finalConfig.colors);

    if (finalConfig.playSound) {
      this.playCelebrationSound();
    }

    if (finalConfig.text) {
      this.showCelebrationText(finalConfig.text, finalConfig.duration, finalConfig.showMusicControl, finalConfig.dismissTextOnly);
    }

    this.startAnimation();

    // Only auto-stop if duration is specified (> 0)
    if (finalConfig.duration > 0) {
      setTimeout(() => {
        this.stopCelebration();
      }, finalConfig.duration);
    }
  }

  private setupCanvas(): void {
    // Create canvas element if it doesn't exist
    this.canvas = document.getElementById('confetti-canvas') as HTMLCanvasElement;
    
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.id = 'confetti-canvas';
      this.canvas.style.position = 'fixed';
      this.canvas.style.top = '0';
      this.canvas.style.left = '0';
      this.canvas.style.width = '100%';
      this.canvas.style.height = '100%';
      this.canvas.style.pointerEvents = 'none';
      this.canvas.style.zIndex = '9999';
      document.body.appendChild(this.canvas);
    }
    
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.ctx = this.canvas.getContext('2d');
  }

  private createParticles(count: number, colors: string[]): void {
    this.particles = [];
    
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: Math.random() * window.innerWidth,
        y: -10,
        vx: (Math.random() - 0.5) * 8,
        vy: Math.random() * 5 + 2,
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 10,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: Math.random() * 10 + 6,
        gravity: Math.random() * 0.3 + 0.1,
        life: 1,
        maxLife: Math.random() * 3 + 2,
        shape: ['square', 'circle', 'triangle'][Math.floor(Math.random() * 3)] as 'square' | 'circle' | 'triangle'
      });
    }
  }

  private startAnimation(): void {
    if (!this.ctx) return;

    let frameCount = 0;
    const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FECA57', '#FF9FF3', '#54A0FF', '#00D2D3', '#FF1744', '#76FF03', '#E91E63', '#9C27B0', '#673AB7', '#FF9800', '#795548'];

    const animate = () => {
      if (!this.ctx || !this.canvas) return;

      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

      // Add new particles periodically for continuous celebration
      frameCount++;
      if (frameCount % 15 === 0 && this.isPlaying) { // Add new particles every 15 frames (~4 times per second)
        this.addNewParticles(35, colors); // Add 35 new particles for continuous shower!
      }

      for (let i = this.particles.length - 1; i >= 0; i--) {
        const particle = this.particles[i];

        // Update particle physics
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vy += particle.gravity;
        particle.rotation += particle.rotationSpeed;
        particle.life -= 0.012; // Slower fade for longer-lasting particles

        // Remove dead particles
        if (particle.life <= 0 || particle.y > window.innerHeight + 100) {
          this.particles.splice(i, 1);
          continue;
        }

        // Draw particle with enhanced glow effect
        this.ctx.save();
        this.ctx.translate(particle.x, particle.y);
        this.ctx.rotate(particle.rotation * Math.PI / 180);

        const alpha = Math.max(0, Math.min(1, particle.life));
        this.ctx.globalAlpha = alpha;

        // Add glow effect
        this.ctx.shadowColor = particle.color;
        this.ctx.shadowBlur = 16 * alpha;

        this.ctx.fillStyle = particle.color;
        this.drawParticle(particle);

        this.ctx.restore();
      }

      // Continue animation as long as celebration is active
      if (this.isPlaying) {
        this.animationId = requestAnimationFrame(animate);
      }
    };

    animate();
  }

  private addNewParticles(count: number, colors: string[]): void {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: Math.random() * window.innerWidth,
        y: -20,
        vx: (Math.random() - 0.5) * 12,
        vy: Math.random() * 6 + 2,
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 15,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: Math.random() * 12 + 8,
        gravity: Math.random() * 0.4 + 0.15,
        life: 1,
        maxLife: Math.random() * 4 + 3,
        shape: ['square', 'circle', 'triangle'][Math.floor(Math.random() * 3)] as 'square' | 'circle' | 'triangle'
      });
    }
  }

  private drawParticle(particle: Particle): void {
    if (!this.ctx) return;
    
    const halfSize = particle.size / 2;
    
    switch (particle.shape) {
      case 'circle':
        this.ctx.beginPath();
        this.ctx.arc(0, 0, halfSize, 0, Math.PI * 2);
        this.ctx.fill();
        break;
        
      case 'square':
        this.ctx.fillRect(-halfSize, -halfSize, particle.size, particle.size);
        break;
        
      case 'triangle':
        this.ctx.beginPath();
        this.ctx.moveTo(0, -halfSize);
        this.ctx.lineTo(-halfSize, halfSize);
        this.ctx.lineTo(halfSize, halfSize);
        this.ctx.closePath();
        this.ctx.fill();
        break;
    }
  }

  private playCelebrationSound(): void {
    try {
      // Create a new audio context for each celebration
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      // Create an uplifting melody
      const melody = [
        { freq: 523.25, time: 0 },     // C5
        { freq: 659.25, time: 0.15 },  // E5
        { freq: 783.99, time: 0.3 },   // G5
        { freq: 1046.50, time: 0.45 }, // C6
        { freq: 783.99, time: 0.6 },   // G5
        { freq: 1046.50, time: 0.75 }  // C6
      ];
      
      // Set initial frequency
      oscillator.frequency.setValueAtTime(melody[0].freq, audioContext.currentTime);
      
      // Schedule frequency changes
      melody.forEach(note => {
        oscillator.frequency.setValueAtTime(note.freq, audioContext.currentTime + note.time);
      });
      
      // Volume envelope
      gainNode.gain.setValueAtTime(0, audioContext.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.05);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 1.2);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 1.2);
    } catch (error) {
      console.warn('Could not play celebration sound:', error);
    }
  }

  private showCelebrationText(text: string, duration: number, showMusicControl: boolean, dismissTextOnly: boolean): void {
    // Remove existing celebration text if any
    const existing = document.getElementById('celebration-text');
    if (existing) {
      existing.remove();
    }

    // Create text overlay container
    const textContainer = document.createElement('div');
    textContainer.id = 'celebration-text';
    textContainer.style.cssText = `
      position: fixed;
      top: 15%;
      left: 50%;
      transform: translateX(-50%);
      z-index: 10000;
      text-align: center;
      pointer-events: auto;
      font-family: 'Arial', sans-serif;
    `;

    // Create main text element
    const textOverlay = document.createElement('div');
    textOverlay.className = 'celebration-main-text';
    textOverlay.innerHTML = text;
    textOverlay.style.cssText = `
      font-size: 3.5rem;
      font-weight: 900;
      margin-bottom: 20px;
      color: white;
      white-space: nowrap;
      overflow: visible;
      text-overflow: clip;
      max-width: none;
      width: max-content;
      text-shadow:
        0 0 10px rgba(255, 255, 255, 0.9),
        0 0 20px rgba(255, 215, 0, 0.8),
        0 0 30px rgba(78, 205, 196, 0.7),
        0 0 40px rgba(138, 43, 226, 0.6),
        0 0 50px rgba(0, 150, 255, 0.5),
        0 0 60px rgba(0, 255, 127, 0.4);
      animation: celebrationPulse 1.5s ease-in-out infinite alternate, rainbowGlow 2s ease-in-out infinite;
      filter: drop-shadow(0 4px 12px rgba(0,0,0,0.4));
    `;

    // Create subtitle
    const subtitle = document.createElement('div');
    subtitle.className = 'celebration-subtitle';
    subtitle.innerHTML = '🚀 CONGRATULATIONS! 💰';
    subtitle.style.cssText = `
      font-size: 2.5rem;
      font-weight: bold;
      margin-bottom: 30px;
      color: white;
      white-space: nowrap;
      text-shadow:
        0 0 8px rgba(255, 255, 255, 0.9),
        0 0 16px rgba(255, 215, 0, 0.8),
        0 0 24px rgba(78, 205, 196, 0.7),
        0 0 32px rgba(138, 43, 226, 0.6),
        0 0 40px rgba(0, 255, 255, 0.5);
      animation: subtitleGlow 2s ease-in-out infinite, subtitleFloat 2s ease-in-out infinite;
    `;

    // Create close button
    const closeButton = document.createElement('button');
    closeButton.innerHTML = dismissTextOnly ? '✕ Hide Text' : '✕ Close Celebration';
    closeButton.style.cssText = `
      background: ${dismissTextOnly ? 'linear-gradient(135deg, #7C3AED, #8B5CF6)' : 'linear-gradient(45deg, #FF6B6B, #4ECDC4)'};
      border: none;
      border-radius: 25px;
      padding: ${dismissTextOnly ? '7px 13px' : '12px 24px'};
      color: white;
      font-weight: bold;
      font-size: ${dismissTextOnly ? '0.78rem' : '1rem'};
      cursor: pointer;
      box-shadow: 0 4px 15px rgba(0,0,0,0.3);
      transition: all 0.3s ease;
      animation: buttonPulse 2s ease-in-out infinite;
    `;

    closeButton.addEventListener('mouseenter', () => {
      closeButton.style.transform = 'scale(1.1)';
      closeButton.style.boxShadow = '0 6px 20px rgba(0,0,0,0.4)';
    });

    closeButton.addEventListener('mouseleave', () => {
      closeButton.style.transform = 'scale(1)';
      closeButton.style.boxShadow = '0 4px 15px rgba(0,0,0,0.3)';
    });

    closeButton.addEventListener('click', () => {
      if (dismissTextOnly) {
        this.hideCelebrationText();
      } else {
        this.stopCelebration();
      }
    });

    let musicButton: HTMLButtonElement | null = null;
    if (showMusicControl) {
      musicButton = document.createElement('button');
      musicButton.innerHTML = '⏸ Pause Music';
      musicButton.style.cssText = `
        margin-left: 12px;
        background: linear-gradient(45deg, #667eea, #764ba2);
        border: none;
        border-radius: 25px;
        padding: 12px 24px;
        color: white;
        font-weight: bold;
        font-size: 1rem;
        cursor: pointer;
        box-shadow: 0 4px 15px rgba(0,0,0,0.3);
        transition: all 0.3s ease;
      `;
      musicButton.addEventListener('click', async () => {
        if (!musicButton) return;
        await this.toggleCelebrationMusic();
        musicButton.innerHTML = this.celebrationMusic.paused ? '▶ Play Music' : '⏸ Pause Music';
      });
    }

    // Add enhanced CSS animations
    if (!document.getElementById('celebration-styles')) {
      const style = document.createElement('style');
      style.id = 'celebration-styles';
      style.textContent = `
        @keyframes celebrationPulse {
          0% { transform: scale(1); }
          100% { transform: scale(1.05); }
        }
        @keyframes gradientShift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes subtitleFloat {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-5px); }
        }
        @keyframes buttonPulse {
          0%, 100% { box-shadow: 0 4px 15px rgba(0,0,0,0.3); }
          50% { box-shadow: 0 6px 25px rgba(255, 215, 0, 0.4); }
        }
        @keyframes celebrationFadeIn {
          0% { opacity: 0; transform: translateX(-50%) translateY(-30px) scale(0.8); }
          100% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
        }
        @keyframes subtitleGlow {
          0% {
            text-shadow:
              0 0 8px rgba(255, 255, 255, 0.9),
              0 0 16px rgba(255, 215, 0, 0.8),
              0 0 24px rgba(78, 205, 196, 0.7),
              0 0 32px rgba(138, 43, 226, 0.6),
              0 0 40px rgba(0, 255, 255, 0.5);
          }
          25% {
            text-shadow:
              0 0 10px rgba(255, 255, 255, 1),
              0 0 20px rgba(78, 205, 196, 0.9),
              0 0 28px rgba(138, 43, 226, 0.8),
              0 0 36px rgba(0, 255, 255, 0.7),
              0 0 44px rgba(255, 215, 0, 0.6);
          }
          50% {
            text-shadow:
              0 0 12px rgba(255, 255, 255, 1),
              0 0 24px rgba(138, 43, 226, 0.9),
              0 0 32px rgba(0, 255, 255, 0.8),
              0 0 40px rgba(255, 215, 0, 0.7),
              0 0 48px rgba(78, 205, 196, 0.6);
          }
          75% {
            text-shadow:
              0 0 10px rgba(255, 255, 255, 1),
              0 0 20px rgba(0, 255, 255, 0.9),
              0 0 28px rgba(255, 215, 0, 0.8),
              0 0 36px rgba(78, 205, 196, 0.7),
              0 0 44px rgba(138, 43, 226, 0.6);
          }
          100% {
            text-shadow:
              0 0 8px rgba(255, 255, 255, 0.9),
              0 0 16px rgba(255, 215, 0, 0.8),
              0 0 24px rgba(78, 205, 196, 0.7),
              0 0 32px rgba(138, 43, 226, 0.6),
              0 0 40px rgba(0, 255, 255, 0.5);
          }
        }
        @keyframes rainbowGlow {
          0% {
            text-shadow:
              0 0 10px rgba(255, 255, 255, 0.9),
              0 0 20px rgba(255, 215, 0, 0.8),
              0 0 30px rgba(78, 205, 196, 0.7),
              0 0 40px rgba(138, 43, 226, 0.6),
              0 0 50px rgba(0, 150, 255, 0.5),
              0 0 60px rgba(0, 255, 127, 0.4);
          }
          25% {
            text-shadow:
              0 0 12px rgba(255, 255, 255, 1),
              0 0 25px rgba(78, 205, 196, 0.9),
              0 0 35px rgba(138, 43, 226, 0.8),
              0 0 45px rgba(0, 150, 255, 0.7),
              0 0 55px rgba(255, 215, 0, 0.6),
              0 0 65px rgba(0, 255, 127, 0.5);
          }
          50% {
            text-shadow:
              0 0 15px rgba(255, 255, 255, 1),
              0 0 30px rgba(138, 43, 226, 0.9),
              0 0 40px rgba(0, 150, 255, 0.8),
              0 0 50px rgba(255, 215, 0, 0.7),
              0 0 60px rgba(0, 255, 127, 0.6),
              0 0 70px rgba(78, 205, 196, 0.5);
          }
          75% {
            text-shadow:
              0 0 12px rgba(255, 255, 255, 1),
              0 0 25px rgba(0, 150, 255, 0.9),
              0 0 35px rgba(255, 215, 0, 0.8),
              0 0 45px rgba(0, 255, 127, 0.7),
              0 0 55px rgba(78, 205, 196, 0.6),
              0 0 65px rgba(138, 43, 226, 0.5);
          }
          100% {
            text-shadow:
              0 0 10px rgba(255, 255, 255, 0.9),
              0 0 20px rgba(255, 215, 0, 0.8),
              0 0 30px rgba(78, 205, 196, 0.7),
              0 0 40px rgba(138, 43, 226, 0.6),
              0 0 50px rgba(0, 150, 255, 0.5),
              0 0 60px rgba(0, 255, 127, 0.4);
          }
        }
      `;
      document.head.appendChild(style);
    }

    // Assemble the components
    textContainer.appendChild(textOverlay);
    textContainer.appendChild(subtitle);
    textContainer.appendChild(closeButton);
    if (musicButton) textContainer.appendChild(musicButton);

    textContainer.style.animation = 'celebrationFadeIn 0.8s ease-out';

    document.body.appendChild(textContainer);

    // Only remove after duration if duration > 0
    if (duration > 0) {
      setTimeout(() => {
        if (textContainer.parentNode) {
          textContainer.style.animation = 'celebrationFadeIn 0.5s ease-out reverse';
          setTimeout(() => {
            textContainer.remove();
          }, 500);
        }
      }, duration - 500);
    }
  }

  private stopCelebration(): void {
    this.isPlaying = false;
    this.celebrationMusic.pause();
    this.celebrationMusic.currentTime = 0;

    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
      this.ctx = null;
    }

    this.hideCelebrationText();
    this.particles = [];
  }

  async playCelebrationMusic(): Promise<void> {
    this.celebrationMusic.loop = true;
    if (this.celebrationMusic.ended) this.celebrationMusic.currentTime = 0;
    try {
      await this.celebrationMusic.play();
    } catch (error) {
      console.warn('Could not play profit-target music:', error);
    }
  }

  async toggleCelebrationMusic(): Promise<void> {
    if (this.celebrationMusic.paused) {
      await this.playCelebrationMusic();
    } else {
      this.celebrationMusic.pause();
    }
  }

  // Public method to manually stop celebration
  stopCurrentCelebration(): void {
    this.stopCelebration();
  }

  celebratePayout(): void {
    this.stopPayoutCelebrationMusic();
    this.stopCelebration();
    this.celebrate({
      text: 'Payout received! <br>💸Woohooooo! 🥰💰',
      duration: 0,
      particleCount: 2600,
      playSound: false,
      showMusicControl: false,
      dismissTextOnly: true,
      colors: ['#FFD700', '#FFF7AE', '#FF6B6B', '#FF9FF3', '#A78BFA', '#54A0FF', '#4ECDC4', '#00D2D3', '#76FF03', '#FECA57']
    });
    void this.playPayoutCelebrationMusic();
  }

  private async playPayoutCelebrationMusic(): Promise<void> {
    this.payoutCelebrationMusic.loop = false;
    this.payoutCelebrationMusic.currentTime = 0;
    try {
      await this.payoutCelebrationMusic.play();
      this.showPayoutMusicNotification();
    } catch (error) {
      this.removePayoutMusicNotification();
      console.warn('Could not play payout celebration music:', error);
    }
  }

  private showPayoutMusicNotification(): void {
    this.removePayoutMusicNotification();
    this.ensurePayoutMusicStyles();

    const notification = document.createElement('aside');
    notification.className = 'payout-music-notification';
    notification.setAttribute('role', 'status');
    notification.setAttribute('aria-live', 'polite');

    const icon = document.createElement('span');
    icon.className = 'material-icons payout-music-icon';
    icon.textContent = 'music_note';
    icon.setAttribute('aria-hidden', 'true');

    const copy = document.createElement('div');
    copy.className = 'payout-music-notification-copy';
    const label = document.createElement('strong');
    label.textContent = 'Music playing';
    const title = document.createElement('span');
    title.textContent = 'Multo';
    copy.append(label, title);

    const stopButton = document.createElement('button');
    stopButton.className = 'payout-music-stop-button';
    stopButton.type = 'button';
    stopButton.textContent = 'Stop';
    stopButton.setAttribute('aria-label', 'Stop payout music');
    stopButton.addEventListener('click', () => this.stopPayoutCelebrationMusic());

    notification.append(icon, copy, stopButton);
    document.body.appendChild(notification);
    this.payoutMusicNotification = notification;
  }

  private removePayoutMusicNotification(): void {
    this.payoutMusicNotification?.remove();
    this.payoutMusicNotification = null;
  }

  private stopPayoutCelebrationMusic(stopConfetti = true): void {
    this.payoutCelebrationMusic.pause();
    this.payoutCelebrationMusic.currentTime = 0;
    this.removePayoutMusicNotification();
    if (stopConfetti) this.stopCelebration();
  }

  private hideCelebrationText(): void {
    const textOverlay = document.getElementById('celebration-text');
    if (!textOverlay) return;

    textOverlay.style.animation = 'celebrationFadeIn 0.5s ease-out reverse';
    setTimeout(() => {
      if (textOverlay.parentNode) textOverlay.remove();
    }, 500);
  }

  private ensurePayoutMusicStyles(): void {
    if (document.getElementById('payout-music-styles')) return;

    const style = document.createElement('style');
    style.id = 'payout-music-styles';
    style.textContent = `
      .payout-music-notification {
        position: fixed;
        top: 24px;
        right: 24px;
        z-index: 10001;
        display: flex;
        align-items: center;
        gap: 12px;
        width: min(340px, calc(100vw - 48px));
        padding: 14px 16px;
        border: 1px solid #DDD6FE;
        border-radius: 18px;
        background: linear-gradient(135deg, #FFFFFF 0%, #EDE9FE 100%);
        box-shadow: 0 16px 40px rgba(124, 58, 237, 0.16), 0 0 24px rgba(139, 92, 246, 0.18);
        color: #334155;
        font-family: inherit;
        animation: payoutMusicNotificationIn 0.35s ease-out;
        backdrop-filter: blur(14px);
      }
      .payout-music-icon {
        display: grid;
        flex: 0 0 38px;
        width: 38px;
        height: 38px;
        place-items: center;
        border-radius: 12px;
        background: linear-gradient(135deg, #7C3AED, #8B5CF6);
        color: #FFFFFF;
        font-size: 22px;
        animation: payoutMusicIconPulse 1.2s ease-in-out infinite;
      }
      .payout-music-notification-copy {
        display: grid;
        gap: 3px;
        min-width: 0;
        flex: 1;
      }
      .payout-music-notification-copy strong {
        font-size: 0.82rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .payout-music-notification-copy span {
        overflow: hidden;
        color: #64748B;
        font-size: 0.92rem;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .payout-music-stop-button {
        flex: 0 0 auto;
        padding: 8px 13px;
        border: 1px solid #C4B5FD;
        border-radius: 999px;
        background: rgba(124, 58, 237, 0.08);
        color: #6D28D9;
        cursor: pointer;
        font: inherit;
        font-size: 0.82rem;
        font-weight: 700;
        transition: background 0.2s ease, transform 0.2s ease;
      }
      .payout-music-stop-button:hover {
        background: rgba(124, 58, 237, 0.16);
        transform: translateY(-1px);
      }
      body.dark-theme .payout-music-notification {
        border-color: #64748B;
        background: linear-gradient(135deg, #172033 0%, #1E293B 100%);
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.28), 0 0 24px rgba(139, 92, 246, 0.2);
        color: #E2E8F0;
      }
      body.dark-theme .payout-music-notification-copy span {
        color: #CBD5E1;
      }
      body.dark-theme .payout-music-stop-button {
        border-color: #64748B;
        background: rgba(196, 181, 253, 0.12);
        color: #C4B5FD;
      }
      body.dark-theme .payout-music-stop-button:hover {
        background: rgba(196, 181, 253, 0.2);
      }
      @keyframes payoutMusicIconPulse {
        0%, 100% { transform: scale(1); box-shadow: 0 0 0 rgba(124, 58, 237, 0); }
        50% { transform: scale(1.08); box-shadow: 0 0 18px rgba(124, 58, 237, 0.34); }
      }
      @keyframes payoutMusicNotificationIn {
        from { opacity: 0; transform: translateY(-12px) scale(0.96); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @media (max-width: 600px) {
        .payout-music-notification {
          top: 16px;
          right: 16px;
          width: calc(100vw - 32px);
        }
      }
    `;
    document.head.appendChild(style);
  }

  // Public method to trigger different types of celebrations
  celebrateProfitTarget(targetPercentage: number): void {
    this.celebrate({
      text: `${targetPercentage}% PROFIT TARGET REACHED!`,
      duration: 0, // Persistent display, no auto-hide
      particleCount: 1200, // MASSIVE confetti explosion for profit targets!
      colors: ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FECA57', '#FF9FF3', '#54A0FF', '#00D2D3', '#FF1744', '#76FF03', '#E91E63', '#9C27B0', '#673AB7', '#FF9800', '#795548']
    });
  }
}
