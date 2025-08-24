import { Injectable } from '@angular/core';

export interface ConfettiConfig {
  duration?: number;
  particleCount?: number;
  text?: string;
  playSound?: boolean;
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
  private isPlaying = false;

  constructor() {
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
      particleCount: 300, // Increased from 150 to 300 for more confetti!
      text: 'PROFIT TARGET REACHED!',
      playSound: true,
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
      this.showCelebrationText(finalConfig.text, finalConfig.duration);
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
        size: Math.random() * 8 + 4,
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
      if (frameCount % 20 === 0 && this.isPlaying) { // Add new particles every 20 frames (~3 times per second)
        this.addNewParticles(15, colors); // Add 15 new particles
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

        const alpha = Math.max(0, particle.life / particle.maxLife);
        this.ctx.globalAlpha = alpha;

        // Add glow effect
        this.ctx.shadowColor = particle.color;
        this.ctx.shadowBlur = 10 * alpha;

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
        size: Math.random() * 10 + 6,
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

  private showCelebrationText(text: string, duration: number): void {
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
        0 0 30px rgba(255, 107, 107, 0.7),
        0 0 40px rgba(78, 205, 196, 0.6),
        0 0 50px rgba(138, 43, 226, 0.5),
        0 0 60px rgba(255, 20, 147, 0.4);
      animation: celebrationPulse 1.5s ease-in-out infinite alternate, rainbowGlow 2s ease-in-out infinite;
      filter: drop-shadow(0 4px 12px rgba(0,0,0,0.4));
    `;

    // Create subtitle
    const subtitle = document.createElement('div');
    subtitle.className = 'celebration-subtitle';
    subtitle.innerHTML = '🚀 CONGRATULATIONS! 💰';
    subtitle.style.cssText = `
      font-size: 1.5rem;
      font-weight: bold;
      margin-bottom: 30px;
      color: white;
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
    closeButton.innerHTML = '✕ Close Celebration';
    closeButton.style.cssText = `
      background: linear-gradient(45deg, #FF6B6B, #4ECDC4);
      border: none;
      border-radius: 25px;
      padding: 12px 24px;
      color: white;
      font-weight: bold;
      font-size: 1rem;
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
      this.stopCelebration();
    });

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
              0 0 30px rgba(255, 107, 107, 0.7),
              0 0 40px rgba(78, 205, 196, 0.6),
              0 0 50px rgba(138, 43, 226, 0.5),
              0 0 60px rgba(255, 20, 147, 0.4);
          }
          25% {
            text-shadow:
              0 0 12px rgba(255, 255, 255, 1),
              0 0 25px rgba(78, 205, 196, 0.9),
              0 0 35px rgba(138, 43, 226, 0.8),
              0 0 45px rgba(255, 20, 147, 0.7),
              0 0 55px rgba(255, 215, 0, 0.6),
              0 0 65px rgba(255, 107, 107, 0.5);
          }
          50% {
            text-shadow:
              0 0 15px rgba(255, 255, 255, 1),
              0 0 30px rgba(138, 43, 226, 0.9),
              0 0 40px rgba(255, 20, 147, 0.8),
              0 0 50px rgba(255, 215, 0, 0.7),
              0 0 60px rgba(255, 107, 107, 0.6),
              0 0 70px rgba(78, 205, 196, 0.5);
          }
          75% {
            text-shadow:
              0 0 12px rgba(255, 255, 255, 1),
              0 0 25px rgba(255, 20, 147, 0.9),
              0 0 35px rgba(255, 215, 0, 0.8),
              0 0 45px rgba(255, 107, 107, 0.7),
              0 0 55px rgba(78, 205, 196, 0.6),
              0 0 65px rgba(138, 43, 226, 0.5);
          }
          100% {
            text-shadow:
              0 0 10px rgba(255, 255, 255, 0.9),
              0 0 20px rgba(255, 215, 0, 0.8),
              0 0 30px rgba(255, 107, 107, 0.7),
              0 0 40px rgba(78, 205, 196, 0.6),
              0 0 50px rgba(138, 43, 226, 0.5),
              0 0 60px rgba(255, 20, 147, 0.4);
          }
        }
      `;
      document.head.appendChild(style);
    }

    // Assemble the components
    textContainer.appendChild(textOverlay);
    textContainer.appendChild(subtitle);
    textContainer.appendChild(closeButton);

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

    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
      this.ctx = null;
    }

    const textOverlay = document.getElementById('celebration-text');
    if (textOverlay) {
      // Smooth fade out
      textOverlay.style.animation = 'celebrationFadeIn 0.5s ease-out reverse';
      setTimeout(() => {
        if (textOverlay.parentNode) {
          textOverlay.remove();
        }
      }, 500);
    }

    this.particles = [];
  }

  // Public method to manually stop celebration
  stopCurrentCelebration(): void {
    this.stopCelebration();
  }

  // Public method to trigger different types of celebrations
  celebrateProfitTarget(targetPercentage: number): void {
    this.celebrate({
      text: `${targetPercentage}% PROFIT TARGET REACHED!`,
      duration: 0, // Persistent display, no auto-hide
      particleCount: 500, // More confetti for extra celebration!
      colors: ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FECA57', '#FF9FF3', '#54A0FF', '#00D2D3', '#FF1744', '#76FF03', '#E91E63', '#9C27B0', '#673AB7', '#FF9800', '#795548']
    });
  }

  celebrateBigWin(amount: number): void {
    this.celebrate({
      text: `💰 MASSIVE WIN! +$${amount.toFixed(2)} 💰<br><span style="font-size: 0.6em;">Keep this momentum going! 🔥</span>`,
      duration: 4000,
      particleCount: 400,
      colors: ['#FFD700', '#32CD32', '#00FF7F', '#ADFF2F']
    });
  }
}
