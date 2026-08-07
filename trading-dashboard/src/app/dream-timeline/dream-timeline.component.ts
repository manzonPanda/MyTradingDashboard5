import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { interval, Subscription } from 'rxjs';

interface TimeElapsed {
  years: number;
  months: number;
  days: number;
}

@Component({
  selector: 'app-dream-timeline',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dream-timeline.component.html',
  styleUrls: ['./dream-timeline.component.scss']
})
export class DreamTimelineComponent implements OnInit, OnDestroy {
  dreamStartDate = new Date('2023-08-11T06:41:00');
  timeElapsed: TimeElapsed = { years: 0, months: 0, days: 0 };
  private timerSubscription?: Subscription;
  isAnniversaryMonth = false;
  showConfetti = false;

  ngOnInit(): void {
    this.calculateTimeElapsed();
    this.checkAnniversaryMonth();

    this.timerSubscription = interval(1000).subscribe(() => {
      this.calculateTimeElapsed();
      this.checkAnniversaryMonth();
    });
  }

  ngOnDestroy(): void {
    if (this.timerSubscription) {
      this.timerSubscription.unsubscribe();
    }
  }

  calculateTimeElapsed(): void {
    const now = new Date();
    let years = now.getFullYear() - this.dreamStartDate.getFullYear();
    let months = now.getMonth() - this.dreamStartDate.getMonth();
    let days = now.getDate() - this.dreamStartDate.getDate();
    
    if (days < 0) {
      months--;
      const lastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
      days += lastMonth.getDate();
    }
    
    if (months < 0) {
      years--;
      months += 12;
    }
    
    this.timeElapsed = { years, months, days: Math.abs(days) };
  }

  checkAnniversaryMonth(): void {
    const now = new Date();
    const anniversaryStart = new Date(now.getFullYear(), 7, 11, 6, 41, 0);
    const anniversaryEnd = new Date(anniversaryStart);
    anniversaryEnd.setDate(anniversaryStart.getDate() + 30);
    const isWithinAnniversaryPeriod = now >= anniversaryStart && now <= anniversaryEnd;

    if (isWithinAnniversaryPeriod !== this.isAnniversaryMonth) {
      this.isAnniversaryMonth = isWithinAnniversaryPeriod;
      this.showConfetti = isWithinAnniversaryPeriod;
    }
  }

}
