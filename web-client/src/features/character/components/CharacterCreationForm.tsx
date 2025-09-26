/**
 * Character Creation Form Component - TileMUD Web Client
 * 
 * This component provides an accessible form for creating new characters
 * with validation feedback and progress indication.
 * 
 * Features:
 * - Real-time validation with clear error feedback
 * - Accessible form controls with proper labeling
 * - Mobile-responsive design with 44px touch targets
 * - Loading states and submission feedback
 * - TypeScript integration with character types
 */

import React, { useState, useRef } from 'react'
import type { CreateCharacterRequest } from '../../../types/domain'
import type { BusinessErrorClass, ServiceErrorClass } from '../../../types/errors'
import './CharacterCreationForm.css'

// Union type for character creation errors
type CharacterCreationError = BusinessErrorClass | ServiceErrorClass | Error

interface CharacterCreationFormProps {
  /** Called when form is submitted with valid data */
  onSubmit: (character: CreateCharacterRequest & { description?: string }) => Promise<void>
  
  /** Available archetypes for selection */
  archetypes: Array<{ id: string; name: string; description: string }>
  
  /** Whether the form is in a submitting state */
  isSubmitting?: boolean
  
  /** Error to display from submission attempt */
  error?: CharacterCreationError | null
  
  /** Additional CSS classes */
  className?: string
}

interface FormData {
  name: string
  archetypeId: string
  description: string
}

interface ValidationErrors {
  name?: string | undefined
  archetypeId?: string | undefined
  description?: string | undefined
  form?: string | undefined
}

const CHARACTER_NAME_MIN_LENGTH = 2
const CHARACTER_NAME_MAX_LENGTH = 20
const CHARACTER_DESCRIPTION_MAX_LENGTH = 500

export function CharacterCreationForm({
  onSubmit,
  archetypes,
  isSubmitting = false,
  error = null,
  className = ''
}: CharacterCreationFormProps) {
  // Form state
  const [formData, setFormData] = useState<FormData>({
    name: '',
    archetypeId: '',
    description: ''
  })
  
  // Validation state
  const [errors, setErrors] = useState<ValidationErrors>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  
  // Focus management
  const nameRef = useRef<HTMLInputElement>(null)
  const firstErrorRef = useRef<HTMLDivElement>(null)
  
  /**
   * Validates a single field and returns error message if invalid
   */
  const validateField = (name: keyof FormData, value: string): string | undefined => {
    switch (name) {
      case 'name':
        if (!value.trim()) {
          return 'Character name is required'
        }
        if (value.trim().length < CHARACTER_NAME_MIN_LENGTH) {
          return `Character name must be at least ${CHARACTER_NAME_MIN_LENGTH} characters`
        }
        if (value.trim().length > CHARACTER_NAME_MAX_LENGTH) {
          return `Character name must not exceed ${CHARACTER_NAME_MAX_LENGTH} characters`
        }
        if (!/^[a-zA-Z0-9\s'-]+$/.test(value.trim())) {
          return 'Character name can only contain letters, numbers, spaces, hyphens, and apostrophes'
        }
        break
        
      case 'archetypeId':
        if (!value.trim()) {
          return 'Please select a character archetype'
        }
        break
        
      case 'description':
        if (value.length > CHARACTER_DESCRIPTION_MAX_LENGTH) {
          return `Description must not exceed ${CHARACTER_DESCRIPTION_MAX_LENGTH} characters`
        }
        break
    }
    return undefined
  }
  
  /**
   * Validates all form fields and returns validation errors
   */
  const validateForm = (data: FormData): ValidationErrors => {
    const validationErrors: ValidationErrors = {}
    
    const nameError = validateField('name', data.name)
    if (nameError) {
      validationErrors.name = nameError
    }
    
    const archetypeError = validateField('archetypeId', data.archetypeId)
    if (archetypeError) {
      validationErrors.archetypeId = archetypeError
    }
    
    const descriptionError = validateField('description', data.description)
    if (descriptionError) {
      validationErrors.description = descriptionError
    }
    
    return validationErrors
  }
  
  /**
   * Handles input changes with real-time validation
   */
  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = event.target
    const fieldName = name as keyof FormData
    
    // Update form data
    setFormData(prev => ({ ...prev, [fieldName]: value }))
    
    // Clear previous validation error for this field if it was touched
    if (touched[fieldName]) {
      const fieldError = validateField(fieldName, value)
      setErrors(prev => ({ ...prev, [fieldName]: fieldError }))
    }
  }
  
  /**
   * Handles field blur events for validation
   */
  const handleBlur = (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = event.target
    const fieldName = name as keyof FormData
    
    // Mark field as touched
    setTouched(prev => ({ ...prev, [fieldName]: true }))
    
    // Validate the field
    const fieldError = validateField(fieldName, value)
    setErrors(prev => ({ ...prev, [fieldName]: fieldError }))
  }
  
  /**
   * Handles form submission
   */
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    
    // Validate all fields
    const validationErrors = validateForm(formData)
    setErrors(validationErrors)
    
    // Mark all fields as touched
    setTouched({ name: true, archetypeId: true, description: true })
    
    // Check if form is valid
    if (Object.keys(validationErrors).length > 0) {
      // Focus first error field
      setTimeout(() => {
        if (validationErrors.name && nameRef.current) {
          nameRef.current.focus()
        } else if (firstErrorRef.current) {
          firstErrorRef.current.focus()
        }
      }, 0)
      return
    }
    
    try {
      // Clear any previous form-level errors
      setErrors(prev => ({ ...prev, form: undefined }))
      
      // Submit the form
      const submissionData: CreateCharacterRequest & { description?: string } = {
        name: formData.name.trim(),
        archetypeId: formData.archetypeId
      }
      
      const trimmedDescription = formData.description.trim()
      if (trimmedDescription) {
        submissionData.description = trimmedDescription
      }
      
      await onSubmit(submissionData)
      
      // Reset form on successful submission
      setFormData({ name: '', archetypeId: '', description: '' })
      setTouched({})
      setErrors({})
      
      // Focus back to name field for next character
      if (nameRef.current) {
        nameRef.current.focus()
      }
      
    } catch {
      // Handle submission errors
      setErrors(prev => ({ 
        ...prev, 
        form: 'Failed to create character. Please try again.'
      }))
    }
  }
  
  // Check if form has any validation errors
  const hasErrors = Object.values(errors).some(error => error !== undefined)
  const isFormValid = !hasErrors && 
    formData.name.trim().length >= CHARACTER_NAME_MIN_LENGTH &&
    formData.archetypeId.trim().length > 0
  
  // Character count for description
  const descriptionLength = formData.description.length
  const descriptionRemaining = CHARACTER_DESCRIPTION_MAX_LENGTH - descriptionLength
  
  return (
    <div className={`character-creation-form ${className}`}>
      <div className="form-header">
        <h2>Create New Character</h2>
        <p>Bring your character to life in the world of TileMUD.</p>
      </div>
      
      {/* Display submission error */}
      {error && (
        <div className="error-banner" role="alert" aria-live="polite">
          <strong>Error:</strong> {error.message}
          {'validationErrors' in error && error.validationErrors && error.validationErrors.length > 0 && (
            <div className="error-details">
              {error.validationErrors.map((validationError, index) => (
                <div key={index} className="error-detail">
                  <strong>{validationError.field}:</strong> {validationError.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      
      {/* Display form-level validation error */}
      {errors.form && (
        <div className="error-banner" role="alert" aria-live="polite">
          {errors.form}
        </div>
      )}
      
      <form onSubmit={handleSubmit} noValidate>
        {/* Character Name Field */}
        <div className="form-field">
          <label htmlFor="character-name" className="form-label">
            Character Name *
          </label>
          <input
            ref={nameRef}
            id="character-name"
            name="name"
            type="text"
            value={formData.name}
            onChange={handleInputChange}
            onBlur={handleBlur}
            disabled={isSubmitting}
            className={`form-input ${errors.name ? 'form-input--error' : ''}`}
            placeholder="Enter your character's name"
            maxLength={CHARACTER_NAME_MAX_LENGTH}
            aria-required="true"
            aria-invalid={errors.name ? 'true' : 'false'}
            aria-describedby={errors.name ? 'name-error' : 'name-help'}
          />
          
          {/* Name help text */}
          <div id="name-help" className="form-help">
            {CHARACTER_NAME_MIN_LENGTH}-{CHARACTER_NAME_MAX_LENGTH} characters. 
            Letters, numbers, spaces, hyphens, and apostrophes only.
          </div>
          
          {/* Name validation error */}
          {errors.name && (
            <div
              ref={errors.name === Object.values(errors)[0] ? firstErrorRef : undefined}
              id="name-error"
              className="form-error"
              role="alert"
              aria-live="polite"
            >
              {errors.name}
            </div>
          )}
        </div>
        
        {/* Character Archetype Field */}
        <div className="form-field">
          <label htmlFor="character-archetype" className="form-label">
            Character Archetype *
          </label>
          <select
            id="character-archetype"
            name="archetypeId"
            value={formData.archetypeId}
            onChange={handleInputChange}
            onBlur={handleBlur}
            disabled={isSubmitting}
            className={`form-select ${errors.archetypeId ? 'form-select--error' : ''}`}
            aria-required="true"
            aria-invalid={errors.archetypeId ? 'true' : 'false'}
            aria-describedby={errors.archetypeId ? 'archetype-error' : 'archetype-help'}
          >
            <option value="">Choose your character's class...</option>
            {archetypes.map((archetype) => (
              <option key={archetype.id} value={archetype.id}>
                {archetype.name}
              </option>
            ))}
          </select>
          
          {/* Archetype help text */}
          <div id="archetype-help" className="form-help">
            Your archetype determines your character's abilities and playstyle.
          </div>
          
          {/* Archetype validation error */}
          {errors.archetypeId && (
            <div
              ref={!errors.name && errors.archetypeId === Object.values(errors)[0] ? firstErrorRef : undefined}
              id="archetype-error"
              className="form-error"
              role="alert"
              aria-live="polite"
            >
              {errors.archetypeId}
            </div>
          )}
        </div>
        
        {/* Character Description Field */}
        <div className="form-field">
          <label htmlFor="character-description" className="form-label">
            Character Description
          </label>
          <textarea
            id="character-description"
            name="description"
            value={formData.description}
            onChange={handleInputChange}
            onBlur={handleBlur}
            disabled={isSubmitting}
            className={`form-textarea ${errors.description ? 'form-textarea--error' : ''}`}
            placeholder="Describe your character's appearance, personality, or background (optional)"
            maxLength={CHARACTER_DESCRIPTION_MAX_LENGTH}
            rows={4}
            aria-invalid={errors.description ? 'true' : 'false'}
            aria-describedby={errors.description ? 'description-error' : 'description-help'}
          />
          
          {/* Description help text with character count */}
          <div id="description-help" className="form-help">
            <span>Optional. Tell other players about your character.</span>
            <span className={`character-count ${descriptionRemaining < 50 ? 'character-count--warning' : ''}`}>
              {descriptionRemaining} characters remaining
            </span>
          </div>
          
          {/* Description validation error */}
          {errors.description && (
            <div
              ref={!errors.name && errors.description === Object.values(errors)[0] ? firstErrorRef : undefined}
              id="description-error"
              className="form-error"
              role="alert"
              aria-live="polite"
            >
              {errors.description}
            </div>
          )}
        </div>
        
        {/* Submit Button */}
        <div className="form-actions">
          <button
            type="submit"
            disabled={isSubmitting || !isFormValid}
            className="submit-button"
            aria-describedby="submit-help"
          >
            {isSubmitting ? (
              <>
                <span className="submit-spinner" aria-hidden="true" />
                Creating Character...
              </>
            ) : (
              'Create Character'
            )}
          </button>
          
          <div id="submit-help" className="form-help">
            {!isFormValid && formData.name.trim() === '' && 
              'Please enter a character name to continue.'
            }
            {!isFormValid && formData.name.trim() !== '' && formData.archetypeId === '' && 
              'Please select a character archetype.'
            }
            {!isFormValid && formData.name.trim() !== '' && formData.archetypeId !== '' && hasErrors && 
              'Please fix the errors above before submitting.'
            }
            {isFormValid && !isSubmitting && 
              'Ready to create your character.'
            }
          </div>
        </div>
      </form>
    </div>
  )
}

export default CharacterCreationForm