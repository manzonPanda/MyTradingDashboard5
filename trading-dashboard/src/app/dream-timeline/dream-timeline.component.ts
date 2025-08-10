import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { interval, Subscription } from 'rxjs';

interface TimeElapsed {
  years: number;
  months: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

@Component({
  selector: 'app-dream-timeline',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatDialogModule
  ],
  templateUrl: './dream-timeline.component.html',
  styleUrls: ['./dream-timeline.component.scss']
})
export class DreamTimelineComponent implements OnInit, OnDestroy {
  dreamStartDate = new Date('2023-08-11T06:41:00');
  timeElapsed: TimeElapsed = {
    years: 0,
    months: 0,
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0
  };
  
  private timerSubscription?: Subscription;
  isAnniversary = false;
  showCelebration = false;
  isAnniversaryMonth = false;
  showConfetti = false;
  
  motivationalQuotes = [
    "Every expert was once a beginner. Every pro was once an amateur.",
    "The journey of a thousand miles begins with one step.",
    "Success is the sum of small efforts repeated day in and day out.",
    "Your dreams don't have an expiration date. Take a deep breath and try again.",
    "The best time to plant a tree was 20 years ago. The second best time is now."
  ];

  currentQuote = this.motivationalQuotes[0]; // Store current quote to avoid change detection errors
  private quoteChangeCounter = 0;

  constructor(private dialog: MatDialog) {}

  ngOnInit() {
    this.calculateTimeElapsed();
    this.checkAnniversary();
    this.setRandomQuote(); // Set initial quote

    // Update every second
    this.timerSubscription = interval(1000).subscribe(() => {
      this.calculateTimeElapsed();
      this.checkAnniversary();

      // Change quote every 30 seconds
      this.quoteChangeCounter++;
      if (this.quoteChangeCounter >= 30) {
        this.setRandomQuote();
        this.quoteChangeCounter = 0;
      }
    });
  }

  ngOnDestroy() {
    if (this.timerSubscription) {
      this.timerSubscription.unsubscribe();
    }
  }

  calculateTimeElapsed() {
    const now = new Date();
    const diff = now.getTime() - this.dreamStartDate.getTime();
    
    const totalSeconds = Math.floor(diff / 1000);
    const totalMinutes = Math.floor(totalSeconds / 60);
    const totalHours = Math.floor(totalMinutes / 60);
    const totalDays = Math.floor(totalHours / 24);
    
    // Calculate years, months, days more accurately
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
    
    const hours = now.getHours() - this.dreamStartDate.getHours();
    const minutes = now.getMinutes() - this.dreamStartDate.getMinutes();
    const seconds = now.getSeconds() - this.dreamStartDate.getSeconds();
    
    this.timeElapsed = {
      years: years,
      months: months,
      days: Math.abs(days),
      hours: Math.abs(hours),
      minutes: Math.abs(minutes),
      seconds: Math.abs(seconds)
    };
  }

  checkAnniversary() {
    const now = new Date();
    const anniversaryThisYear = new Date(now.getFullYear(), 7, 11, 6, 41, 0); // August 11th (month 7 is August)
    
    // Check if today is the anniversary and within the hour
    const isToday = now.toDateString() === anniversaryThisYear.toDateString();
    const isWithinHour = Math.abs(now.getTime() - anniversaryThisYear.getTime()) < 3600000; // 1 hour
    
    if (isToday && isWithinHour && !this.showCelebration) {
      this.isAnniversary = true;
      this.showCelebration = true;
      this.triggerAnniversaryCelebration();
    }
  }

  triggerAnniversaryCelebration() {
    // Add celebration effects
    setTimeout(() => {
      this.showCelebration = false;
    }, 10000); // Show for 10 seconds
  }

  setRandomQuote(): void {
    this.currentQuote = this.motivationalQuotes[Math.floor(Math.random() * this.motivationalQuotes.length)];
  }

  getDreamAge(): string {
    if (this.timeElapsed.years > 0) {
      return `${this.timeElapsed.years} year${this.timeElapsed.years !== 1 ? 's' : ''} strong`;
    } else if (this.timeElapsed.months > 0) {
      return `${this.timeElapsed.months} month${this.timeElapsed.months !== 1 ? 's' : ''} in`;
    } else {
      return `${this.timeElapsed.days} day${this.timeElapsed.days !== 1 ? 's' : ''} young`;
    }
  }
}
