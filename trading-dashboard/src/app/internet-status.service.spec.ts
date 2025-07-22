import { TestBed } from '@angular/core/testing';

import { InternetStatusService } from './internet-status.service';

describe('InternetStatusService', () => {
  let service: InternetStatusService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(InternetStatusService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
