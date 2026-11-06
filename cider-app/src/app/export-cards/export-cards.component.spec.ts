import { appTestProviders } from '../testing/test-providers';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ExportCardsComponent } from './export-cards.component';

describe('ExportCardsComponent', () => {
  let component: ExportCardsComponent;
  let fixture: ComponentFixture<ExportCardsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
    imports: [ExportCardsComponent],
    providers: [...appTestProviders]
})
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(ExportCardsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
