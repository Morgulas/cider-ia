import { Component, forwardRef } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR, FormsModule } from '@angular/forms';
import { DropdownOption } from 'src/app/data-services/types/dropdown-option.type';

import { ColorPickerModule } from 'primeng/colorpicker';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';

@Component({
    selector: 'app-dropdown-option-editor',
    templateUrl: './dropdown-option-editor.component.html',
    styleUrls: ['./dropdown-option-editor.component.scss'],
    standalone: true,
    imports: [FormsModule, ColorPickerModule, InputTextModule, ButtonModule],
    providers: [
        {
            provide: NG_VALUE_ACCESSOR,
            useExisting: forwardRef(() => DropdownOptionEditorComponent),
            multi: true
        }
    ]
})
export class DropdownOptionEditorComponent implements ControlValueAccessor {
    options: DropdownOption[] = [];

    disabled = false;

    // replaced by registerOnTouched / registerOnChange (forms API)
    private onTouched: () => void = () => undefined;
    private onChanged: (value: DropdownOption[]) => void = () => undefined;

    writeValue(obj: unknown): void {
        if (obj) {
            if (Array.isArray(obj)) {
                this.options = obj;
            } else if (typeof obj === 'string') {
                // Fallback or legacy handling if needed, though service should handle this.
                // Assuming the service converts everything to DropdownOption[] before passing here, 
                // but let's be safe.
                try {
                    const parsed = JSON.parse(obj);
                    if (Array.isArray(parsed)) {
                        this.options = parsed;
                    }
                } catch (e) {
                    this.options = [];
                }
            }
        } else {
            this.options = [];
        }
    }

    registerOnChange(fn: (value: DropdownOption[]) => void): void {
        this.onChanged = fn;
    }

    registerOnTouched(fn: () => void): void {
        this.onTouched = fn;
    }

    setDisabledState?(isDisabled: boolean): void {
        this.disabled = isDisabled;
    }

    addOption() {
        this.options.push({ value: '', color: '#ffffff' });
        this.onChange();
    }

    removeOption(index: number) {
        this.options.splice(index, 1);
        this.onChange();
    }

    onChange() {
        this.onChanged(this.options);
        this.onTouched();
    }
}
