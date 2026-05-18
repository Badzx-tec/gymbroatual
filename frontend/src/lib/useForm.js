import { useCallback, useState } from 'react';

/**
 * @typedef {Object} UseFormOptions
 * @property {(values: object) => object} [validate]  Returns {field: 'error'} map
 * @property {(values: object) => void | Promise<void>} [onSubmit]  Called when valid
 */

/**
 * Lightweight form state manager.
 *
 * @param {object} initialValues          Initial field values
 * @param {UseFormOptions} [options]      Optional validate/onSubmit handlers
 *
 * @returns {{
 *   values: object,
 *   errors: object,
 *   touched: object,
 *   submitting: boolean,
 *   handleChange: (event: any) => void,
 *   setFieldValue: (name: string, value: any) => void,
 *   handleBlur: (event: any) => void,
 *   handleSubmit: (event: any) => void,
 *   reset: () => void,
 * }}
 */
export default function useForm(initialValues, options = {}) {
  const { validate, onSubmit } = options;
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const handleChange = useCallback((event) => {
    const { name, value, type, checked } = event.target;
    setValues((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  }, []);

  const setFieldValue = useCallback((name, value) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  const handleBlur = useCallback((event) => {
    const { name } = event.target;
    setTouched((prev) => ({ ...prev, [name]: true }));
    if (validate) {
      const currentValues = { ...values, [name]: event.target.value };
      const fieldErrors = validate(currentValues);
      setErrors((prev) => ({ ...prev, [name]: fieldErrors[name] || '' }));
    }
  }, [validate, values]);

  const handleSubmit = useCallback(async (event) => {
    if (event && event.preventDefault) event.preventDefault();

    const allTouched = Object.fromEntries(Object.keys(values).map((k) => [k, true]));
    setTouched(allTouched);

    let fieldErrors = {};
    if (validate) {
      fieldErrors = validate(values);
      setErrors(fieldErrors);
    }

    if (Object.values(fieldErrors).some(Boolean)) return;

    if (onSubmit) {
      setSubmitting(true);
      try {
        await onSubmit(values);
      } finally {
        setSubmitting(false);
      }
    }
  }, [validate, onSubmit, values]);

  const reset = useCallback(() => {
    setValues(initialValues);
    setErrors({});
    setTouched({});
    setSubmitting(false);
  }, [initialValues]);

  return { values, errors, touched, submitting, handleChange, setFieldValue, handleBlur, handleSubmit, reset };
}
