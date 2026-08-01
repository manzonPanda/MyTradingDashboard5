import { Injectable, NgZone, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';

@Injectable({ providedIn: 'root' })
export class AuraEnergyService {
  private readonly document = inject(DOCUMENT);
  private readonly zone = inject(NgZone);
  private timerId?: number;
  private cleanupId?: number;
  private frameId?: number;
  private resizeObserver?: ResizeObserver;
  private activeOverlay?: HTMLDivElement;
  private activeTarget?: HTMLElement;
  private isDestroyed = false;

  start(): void {
    if (this.prefersReducedMotion() || this.timerId || this.isDestroyed) {
      return;
    }

    this.zone.runOutsideAngular(() => this.scheduleNextPulse(700));
  }

  destroy(): void {
    this.isDestroyed = true;
    this.timerId && window.clearTimeout(this.timerId);
    this.cleanupId && window.clearTimeout(this.cleanupId);
    this.frameId && window.cancelAnimationFrame(this.frameId);
    this.resizeObserver?.disconnect();
    this.removeActivePulse();
  }

  private scheduleNextPulse(delay: number): void {
    this.timerId = window.setTimeout(() => {
      this.timerId = undefined;
      if (this.isDestroyed || this.prefersReducedMotion()) {
        return;
      }

      this.showPulse();
    }, delay);
  }

  private showPulse(): void {
    const targets = Array.from(this.document.querySelectorAll<HTMLElement>('[data-aura-target]'))
      .filter((target) => this.isVisible(target));

    if (!targets.length) {
      this.scheduleNextPulse(this.randomDelay());
      return;
    }

    this.activeTarget = targets[Math.floor(Math.random() * targets.length)];
    this.activeOverlay = this.createOverlay();
    this.document.body.append(this.activeOverlay);
    this.updateOverlayBounds();

    this.resizeObserver = new ResizeObserver(() => this.requestBoundsUpdate());
    this.resizeObserver.observe(this.activeTarget);
    window.addEventListener('scroll', this.requestBoundsUpdate, true);
    window.addEventListener('resize', this.requestBoundsUpdate);

    this.cleanupId = window.setTimeout(() => {
      this.removeActivePulse();
      this.scheduleNextPulse(this.randomDelay());
    }, 2150);
  }

  private createOverlay(): HTMLDivElement {
    const overlay = this.document.createElement('div');
    overlay.className = 'aura-energy-pulse';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <svg class="aura-energy-svg" viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">
        <defs>
          <filter id="aura-energy-bloom" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="1.8" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <rect class="aura-energy-line" x="1.5" y="1.5" width="97" height="97" rx="4" pathLength="100" />
      </svg>`;
    return overlay;
  }

  private requestBoundsUpdate = (): void => {
    if (!this.frameId) {
      this.frameId = window.requestAnimationFrame(() => {
        this.frameId = undefined;
        this.updateOverlayBounds();
      });
    }
  };

  private updateOverlayBounds(): void {
    if (!this.activeTarget || !this.activeOverlay) {
      return;
    }

    const bounds = this.activeTarget.getBoundingClientRect();
    const radius = window.getComputedStyle(this.activeTarget).borderRadius;
    this.activeOverlay.style.left = `${bounds.left - 3}px`;
    this.activeOverlay.style.top = `${bounds.top - 3}px`;
    this.activeOverlay.style.width = `${bounds.width + 6}px`;
    this.activeOverlay.style.height = `${bounds.height + 6}px`;
    this.activeOverlay.style.borderRadius = radius;
  }

  private removeActivePulse(): void {
    this.activeOverlay?.remove();
    this.activeOverlay = undefined;
    this.activeTarget = undefined;
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    window.removeEventListener('scroll', this.requestBoundsUpdate, true);
    window.removeEventListener('resize', this.requestBoundsUpdate);
  }

  private isVisible(target: HTMLElement): boolean {
    const bounds = target.getBoundingClientRect();
    const style = window.getComputedStyle(target);
    return style.display !== 'none' && style.visibility !== 'hidden' && bounds.width > 120 && bounds.height > 80 && bounds.bottom > 0 && bounds.right > 0 && bounds.top < window.innerHeight && bounds.left < window.innerWidth;
  }

  private randomDelay(): number {
    return 5000 + Math.round(Math.random() * 5000);
  }

  private prefersReducedMotion(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
}
