export interface FocusedDirtyGuardResult {
  isDirty: boolean;
  shouldConfirm: boolean;
}

export const useFocusedDirtyGuard = (): FocusedDirtyGuardResult => {
  const checkFocusedField = (): FocusedDirtyGuardResult => {
    const activeElement = document.activeElement;
    
    // Only check form elements that can be dirty
    if (!activeElement || !isFormElement(activeElement)) {
      return { isDirty: false, shouldConfirm: false };
    }
    
    const element = activeElement as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    
    // Check if field is dirty (value differs from default)
    const defaultValue = getDefaultValue(element);
    const isDirty = element.value !== defaultValue;
    
    // Only require confirmation if dirty AND non-empty (per clarification)
    const shouldConfirm = isDirty && element.value.trim() !== '';
    
    return { isDirty, shouldConfirm };
  };
  
  return checkFocusedField();
};

function isFormElement(element: Element): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const tagName = element.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}

function getDefaultValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string {
  if (element.tagName.toLowerCase() === 'select') {
    // For select elements, find the selected option's value
    const selectElement = element as HTMLSelectElement;
    for (let i = 0; i < selectElement.options.length; i++) {
      const option = selectElement.options[i];
      if (option && option.defaultSelected) {
        return option.value;
      }
    }
    return '';
  } else {
    // For input and textarea elements
    return (element as HTMLInputElement | HTMLTextAreaElement).defaultValue || '';
  }
}