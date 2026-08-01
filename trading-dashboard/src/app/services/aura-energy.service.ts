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
  private auraContainer?: HTMLElement;
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

    this.auraContainer = this.document.querySelector<HTMLElement>('.tradezella-dashboard') || undefined;
    this.activeTargets = Array.from(this.document.querySelectorAll<HTMLElement>('[data-aura-target]'))
      .filter((target) => this.isEligibleTarget(target))
      .sort((first, second) => {
        const firstBounds = first.getBoundingClientRect();
        const secondBounds = second.getBoundingClientRect();
        return firstBounds.top - secondBounds.top || firstBounds.left - secondBounds.left;
      });

    if (!this.activeTargets.length) {
      return;
    }

    if (!this.auraContainer) {
      return;
    }

    this.activeOverlay = this.createOverlay();
    this.activeOverlay.classList.add('aura-energy-pathway-preview');
    this.auraContainer.append(this.activeOverlay);
    this.updateRoute();
    this.resizeObserver = new ResizeObserver(() => this.requestRouteUpdate());
    this.resizeObserver.observe(this.auraContainer);
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

    this.auraContainer = this.document.querySelector<HTMLElement>('.tradezella-dashboard') || undefined;
    this.activeTargets = Array.from(this.document.querySelectorAll<HTMLElement>('[data-aura-target]'))
      .filter((target) => this.isEligibleTarget(target))
      .sort((first, second) => {
        const firstBounds = first.getBoundingClientRect();
        const secondBounds = second.getBoundingClientRect();
        return firstBounds.top - secondBounds.top || firstBounds.left - secondBounds.left;
      })
      .slice(0, 4);

    if (!this.activeTargets.length) {
      this.scheduleNextPulse(this.randomDelay());
      return;
    }

    if (!this.auraContainer) {
      return;
    }

    this.activeOverlay = this.createOverlay();
    this.auraContainer.append(this.activeOverlay);
    this.updateRoute();

    this.resizeObserver = new ResizeObserver(() => this.requestRouteUpdate());
    this.resizeObserver.observe(this.auraContainer);
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
            <stop offset="50%" stop-color="#A78BFA" stop-opacity="0.35" />
            <stop offset="82%" stop-color="#E9D5FF" stop-opacity="0.9" />
            <stop offset="100%" stop-color="#FFFFFF" />
          </linearGradient>
          <filter id="aura-energy-bloom" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="2.4" result="wide-blur" />
            <feGaussianBlur in="SourceGraphic" stdDeviation="0.7" result="soft-blur" />
            <feMerge><feMergeNode in="wide-blur" /><feMergeNode in="soft-blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <path id="aura-route-guide" class="aura-energy-guide" />
        <path id="aura-route" class="aura-energy-line" pathLength="1000" />
        <circle class="aura-energy-head" r="6">
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
    const routeGuide = this.activeOverlay.querySelector<SVGPathElement>('#aura-route-guide');
    if (!svg || !route || !routeGuide) {
      return;
    }

    if (!this.auraContainer) {
      return;
    }

    const containerRect = this.auraContainer.getBoundingClientRect();
    const width = this.auraContainer.clientWidth;
    const height = this.auraContainer.clientHeight;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', `${width}`);
    svg.setAttribute('height', `${height}`);

    const boxes = this.activeTargets
      .map((target) => ({ target, bounds: target.getBoundingClientRect() }))
      .filter(({ bounds }) => bounds.width > 0 && bounds.height > 0);
    const routeData = boxes.map(({ target, bounds }) => {
      const targetStyle = window.getComputedStyle(target);
      const radius = Math.min(this.parseRadius(targetStyle.borderTopLeftRadius), bounds.width / 2, bounds.height / 2);
      return {
        left: bounds.left - containerRect.left - 1.5,
        top: bounds.top - containerRect.top - 1.5,
        right: bounds.right - containerRect.left + 1.5,
        bottom: bounds.bottom - containerRect.top + 1.5,
        radius
      };
    });

    if (!routeData.length) {
      return;
    }

    let path = this.roundedRectPath(routeData[0]);
    for (const box of routeData.slice(1)) {
      const previous = routeData[routeData.indexOf(box) - 1];
      const connector = this.createOrthogonalConnector(previous, box);
      if (!connector) {
        break;
      }
      path += connector + this.roundedRectPath(box, true);
    }
    route.setAttribute('d', path);
    routeGuide.setAttribute('d', path);
  }

  private roundedRectPath(box: { left: number; top: number; right: number; bottom: number; radius: number }, continuation = false): string {
    const { left, top, right, bottom, radius } = box;
    const start = continuation ? '' : `M ${left + radius} ${top}`;
    return `${start} H ${right - radius} Q ${right} ${top} ${right} ${top + radius} V ${bottom - radius} Q ${right} ${bottom} ${right - radius} ${bottom} H ${left + radius} Q ${left} ${bottom} ${left} ${bottom - radius} V ${top + radius} Q ${left} ${top} ${left + radius} ${top} Z`;
  }

  private createOrthogonalConnector(
    previous: { left: number; top: number; right: number; bottom: number; radius: number },
    next: { left: number; top: number; right: number; bottom: number; radius: number }
  ): string | undefined {
    const horizontalGap = next.left - previous.right;
    if (horizontalGap > 0) {
      const gutterX = previous.right + horizontalGap / 2;
      const sharedY = Math.max(previous.top, Math.min(next.top, previous.bottom));
      return ` M ${previous.right} ${sharedY} H ${gutterX} V ${next.top} H ${next.left + next.radius}`;
    }

    const reverseHorizontalGap = previous.left - next.right;
    if (reverseHorizontalGap > 0) {
      const gutterX = next.right + reverseHorizontalGap / 2;
      const sharedY = Math.max(previous.top, Math.min(next.top, previous.bottom));
      return ` M ${previous.left} ${sharedY} H ${gutterX} V ${next.top} H ${next.right - next.radius}`;
    }

    const verticalGap = next.top - previous.bottom;
    if (verticalGap > 0) {
      const gutterY = previous.bottom + verticalGap / 2;
      const sharedX = Math.max(previous.left, Math.min(next.left, previous.right));
      return ` M ${sharedX} ${previous.bottom} V ${gutterY} H ${next.left + next.radius} V ${next.top}`;
    }

    const reverseVerticalGap = previous.top - next.bottom;
    if (reverseVerticalGap > 0) {
      const gutterY = next.bottom + reverseVerticalGap / 2;
      const sharedX = Math.max(previous.left, Math.min(next.left, previous.right));
      return ` M ${sharedX} ${previous.top} V ${gutterY} H ${next.left + next.radius} V ${next.bottom}`;
    }

    return undefined;
  }

  private parseRadius(value: string): number {
    const radius = Number.parseFloat(value);
    return Number.isFinite(radius) ? radius : 0;
  }

  private isEligibleTarget(target: HTMLElement): boolean {
    return !target.closest('.dashboard-navigation') && this.isVisible(target);
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

  private randomDelay(): number {
    return 4000 + Math.round(Math.random() * 4000);
  }

  private prefersReducedMotion(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
}
