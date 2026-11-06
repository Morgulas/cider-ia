import { appTestProviders } from '../testing/test-providers';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EntityDialogComponent } from './entity-dialog.component';

describe('EntityDialogComponent', () => {
  let component: EntityDialogComponent<any, any>;
  let fixture: ComponentFixture<EntityDialogComponent<any, any>>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
    imports: [EntityDialogComponent],
    providers: [...appTestProviders]
})
      .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(EntityDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
