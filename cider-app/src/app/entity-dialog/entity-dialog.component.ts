import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { MessageService, PrimeTemplate } from 'primeng/api';
import { EntityField } from '../data-services/types/entity-field.type';
import { EntityService } from '../data-services/types/entity-service.type';
import { FieldType } from '../data-services/types/field-type.type';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';
import TranslateUtils from '../shared/utils/translate-utils';
import { Bind } from 'primeng/bind';
import { Toast } from 'primeng/toast';
import { Dialog } from 'primeng/dialog';
import { Select } from 'primeng/select';
import { FormsModule } from '@angular/forms';
import { DropdownOptionEditorComponent } from '../shared/components/dropdown-option-editor/dropdown-option-editor.component';
import { FileUpload } from 'primeng/fileupload';
import { InputText } from 'primeng/inputtext';
import { ButtonDirective } from 'primeng/button';
import { Ripple } from 'primeng/ripple';
import { AsyncPipe } from '@angular/common';
import { EntityListPipe } from '../data-services/pipes/entity-list.pipe';
import { ToStringPipe } from '../data-services/pipes/to-string.pipe';

@Component({
    selector: 'app-entity-dialog',
    templateUrl: './entity-dialog.component.html',
    styleUrls: ['./entity-dialog.component.scss'],
    providers: [MessageService],
    imports: [Bind, Toast, Dialog, PrimeTemplate, Select, FormsModule, DropdownOptionEditorComponent, FileUpload, InputText, ButtonDirective, Ripple, AsyncPipe, EntityListPipe, ToStringPipe, TranslatePipe]
})
export class EntityDialogComponent<Entity, Identifier extends string | number> implements OnInit, OnChanges {
  @Input() service: EntityService<Entity, Identifier> | undefined;
  @Input() columns: EntityField<Entity>[] = [];
  @Input() visible = false;
  @Input() entity: Entity = {} as Entity;
  @Input() title = '';
  @Output() visibleChange: EventEmitter<boolean> = new EventEmitter<boolean>();
  @Output() created: EventEmitter<Entity> = new EventEmitter<Entity>();
  loading = false;
  FieldType = FieldType;

  constructor(private messageService: MessageService,
    private translate: TranslateService,
    private domSanitizer: DomSanitizer) { }

  ngOnInit(): void {
    if (this.service && this.service.getFields) {
      this.service?.getFields().then(fields => TranslateUtils.translateFields(fields, this.translate))
        .then(fields => this.columns = fields);
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['service'] && this.service && this.service.getFields) {
      this.service.getFields().then(fields => TranslateUtils.translateFields(fields, this.translate))
        .then(fields => this.columns = fields);
    }
  }

  public save() {
    if (!this.service) {
      return;
    }
    const id = (this.entity as any)[this.service?.getIdField()];
    if (id) {
      this.updateExisting(id, this.entity);
    } else {
      this.createNew(this.entity);
    }
  }

  public createNew(entity: Entity) {
    this.loading = true;
    this.service?.create(entity).then(result => {
      this.loading = false;
      this.hideDialog();
      this.messageService.add({ severity: 'success', summary: 'Successful', detail: 'Entity Created', life: 3000 });
      this.created.emit(result);
    }).catch(error => {
      this.loading = false;
    });
  }

  public updateExisting(id: Identifier, entity: Entity) {
    this.loading = true;
    this.service?.update(id, entity).then(result => {
      this.loading = false;
      this.hideDialog();
      this.messageService.add({ severity: 'success', summary: 'Successful', detail: 'Entity Updated', life: 3000 });
    }).catch(error => {
      this.loading = false;
    });
  }

  public uploadFile(entity: Entity, field: string | number | symbol, event: any) {
    if (event?.currentFiles?.length) {
      (entity as any)[field] = event.files[0];
    }
  }

  public hideDialog() {
    this.visible = false;
    this.visibleChange.emit(false);
  }
}
