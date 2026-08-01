import { DOCUMENT } from '@angular/common';
import { Injectable, NgZone, inject } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class AuraEnergyService {
  private readonly pulseDurationMs = 5000;
  private readonly document = inject(DOCUMENT);
  private readonly zone = inject(NgZone);
  private timerId?: number;
  private cleanupId?: number;
  private frameId?: number;
  private resizeObserver?: ResizeObserver;
  private activeOverlay?: HTMLDivElement;
  private activeTargets: HTMLElement[] = [];
  private isDestroyed = false;

  start(): void {
    if (this.prefersReducedMotion() || this.timerId || this.isDestroyed) {
      return;
    }

    this.zone.runOutsideAngular(() => this.scheduleNextPulse(700));
  }

  setPathwayPreview(enabled: boolean): void {
    if (this.isDestroyed) {
      return;
    }

    if (!enabled) {
      this.removeActivePulse();
      this.scheduleNextPulse(this.randomDelay());
      return;
    }

    this.timerId && window.clearTimeout(this.timerId);
    this.timerId = undefined;
    this.cleanupId && window.clearTimeout(this.cleanupId);
    this.cleanupId = undefined;
    this.removeActivePulse();

    this.activeTargets = Array.from(this.document.querySelectorAll<HTMLElement>('[data-aura-target]'))
      .filter((target) => this.isVisible(target))
      .sort((first, second) => {
        const firstBounds = first.getBoundingClientRect();
        const secondBounds = second.getBoundingClientRect();
        return firstBounds.top - secondBounds.top || firstBounds.left - secondBounds.left;
      });

    if (!this.activeTargets.length) {
      return;
    }

    this.activeOverlay = this.createOverlay();
    this.activeOverlay.classList.add('aura-energy-pathway-preview');
    this.document.body.append(this.activeOverlay);
    this.updateRoute();
    this.resizeObserver = new ResizeObserver(() => this.requestRouteUpdate());
    this.activeTargets.forEach((target) => this.resizeObserver?.observe(target));
    window.addEventListener('scroll', this.requestRouteUpdate, true);
    window.addEventListener('resize', this.requestRouteUpdate);
  }

  destroy(): void {
    this.isDestroyed = true;
    this.timerId && window.clearTimeout(this.timerId);
    this.cleanupId && window.clearTimeout(this.cleanupId);
    this.frameId && window.cancelAnimationFrame(this.frameId);
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
    if (this.activeOverlay) {
      return;
    }

    this.activeTargets = this.shuffle(
      Array.from(this.document.querySelectorAll<HTMLElement>('[data-aura-target]'))
        .filter((target) => this.isVisible(target))
    ).slice(0, 4);

    if (!this.activeTargets.length) {
      this.scheduleNextPulse(this.randomDelay());
      return;
    }

    this.activeOverlay = this.createOverlay();
    this.document.body.append(this.activeOverlay);
    this.updateRoute();

    this.resizeObserver = new ResizeObserver(() => this.requestRouteUpdate());
    this.activeTargets.forEach((target) => this.resizeObserver?.observe(target));
    window.addEventListener('scroll', this.requestRouteUpdate, true);
    window.addEventListener('resize', this.requestRouteUpdate);

    this.cleanupId = window.setTimeout(() => {
      this.removeActivePulse();
      this.scheduleNextPulse(this.randomDelay());
    }, this.pulseDurationMs);
  }

  private createOverlay(): HTMLDivElement {
    const overlay = this.document.createElement('div');
    overlay.className = 'aura-energy-pulse';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <svg class="aura-energy-svg" focusable="false" preserveAspectRatio="none">
        <defs>
          <linearGradient id="aura-energy-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#7C3AED" stop-opacity="0" />
            <stop offset="42%" stop-color="#6366F1" stop-opacity="0.15" />
            <stop offset="72%" stop-color="#A78BFA" stop-opacity="0.5" />
            <stop offset="90%" stop-color="#F5F3FF" stop-opacity="0.85" />
            <stop offset="100%" stop-color="#F5F3FF" />
          </linearGradient>
          <filter id="aura-energy-bloom" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="1.2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <path id="aura-route" class="aura-energy-line" pathLength="1000" />
        <circle class="aura-energy-head" r="5.5">
          <animateMotion dur="5s" rotate="auto" fill="freeze">
            <mpath href="#aura-route" />
          </animateMotion>
        </circle>
      </svg>`;
    return overlay;
  }

  private requestRouteUpdate = (): void => {
    if (!this.frameId) {
      this.frameId = window.requestAnimationFrame(() => {
        this.frameId = undefined;
        this.updateRoute();
      });
    }
  };

  private updateRoute(): void {
    if (!this.activeOverlay) {
      return;
    }

    const svg = this.activeOverlay.querySelector<SVGSVGElement>('.aura-energy-svg');
    const route = this.activeOverlay.querySelector<SVGPathElement>('#aura-route');
    if (!svg || !route) {
      return;
    }

    const width = window.innerWidth;
    const height = window.innerHeight;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', `${width}`);
    svg.setAttribute('height', `${height}`);

    const boxes = this.activeTargets
      .map((target) => target.getBoundingClientRect())
      .filter((bounds) => bounds.width > 0 && bounds.height > 0);
    const routeData = boxes.map((bounds) => ({
      left: bounds.left - 3,
      top: bounds.top - 3,
      right: bounds.right + 3,
      bottom: bounds.bottom + 3
    }));

    if (!routeData.length) {
      return;
    }

    const routeX = Math.min(...routeData.map((box) => box.left)) - 8;
    const routeY = Math.min(...routeData.map((box) => box.top)) - 8;
    const first = routeData[0];
    let path = `M ${first.left} ${first.top} H ${first.right} V ${first.bottom} H ${first.left} V ${first.top} Z`;
    for (const box of routeData.slice(1)) {
      path += ` H ${routeX} V ${routeY} H ${box.left} V ${box.top} H ${box.right} V ${box.bottom} H ${box.left} V ${box.top} Z`;
    }
    route.setAttribute('d', path);
  }

  private removeActivePulse(): void {
    this.activeOverlay?.remove();
    this.activeOverlay = undefined;
    this.activeTargets = [];
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    window.removeEventListener('scroll', this.requestRouteUpdate, true);
    window.removeEventListener('resize', this.requestRouteUpdate);
  }

  private isVisible(target: HTMLElement): boolean {
    const bounds = target.getBoundingClientRect();
    const style = window.getComputedStyle(target);
    return style.display !== 'none' && style.visibility !== 'hidden' && bounds.width > 120 && bounds.height > 80 && bounds.bottom > 0 && bounds.right > 0 && bounds.top < window.innerHeight && bounds.left < window.innerWidth;
  }

  private shuffle<T>(items: T[]): T[] {
    return items.sort(() => Math.random() - 0.5);
  }

  private randomDelay(): number {
    return 4000 + Math.round(Math.random() * 4000);
  }

  private prefersReducedMotion(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
}
