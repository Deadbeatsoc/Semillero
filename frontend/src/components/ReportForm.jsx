import React, { useMemo, useState } from 'react';

const initialState = {
  description: '',
  severity: 'media'
};
const MAX_EVIDENCE_BYTES = 6 * 1024 * 1024;

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('No se pudo leer la imagen seleccionada.'));
    reader.readAsDataURL(file);
  });

export default function ReportForm({
  onSubmit,
  submitting,
  selectedLocation,
  isPickingLocation,
  onStartMapPick,
  onCancelMapPick
}) {
  const [formData, setFormData] = useState(initialState);
  const [evidencePreview, setEvidencePreview] = useState('');
  const [evidenceName, setEvidenceName] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const locationLabel = useMemo(() => {
    if (!selectedLocation) {
      return 'Sin punto seleccionado.';
    }
    return `Lat ${selectedLocation.latitude.toFixed(5)}, Lon ${selectedLocation.longitude.toFixed(5)}`;
  }, [selectedLocation]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((previous) => ({ ...previous, [name]: value }));
  };

  const handleEvidenceChange = async (event) => {
    const file = event.target.files?.[0];
    setError('');
    setSuccessMessage('');
    if (!file) {
      setEvidenceName('');
      setEvidencePreview('');
      return;
    }

    if (file.size > MAX_EVIDENCE_BYTES) {
      setEvidenceName('');
      setEvidencePreview('');
      setError('La imagen supera el maximo permitido de 6MB.');
      event.target.value = '';
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setEvidencePreview(dataUrl);
      setEvidenceName(file.name || 'evidencia');
    } catch (fileError) {
      setEvidenceName('');
      setEvidencePreview('');
      setError(fileError.message || 'No se pudo procesar la imagen.');
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    setError('');
    setSuccessMessage('');

    if (!selectedLocation) {
      setError('Selecciona en el mapa el punto del accidente.');
      return;
    }
    if (!formData.description.trim()) {
      setError('La descripcion es obligatoria.');
      return;
    }
    if (!evidencePreview) {
      setError('Debes adjuntar una foto de evidencia.');
      return;
    }

    onSubmit({
      description: formData.description.trim(),
      severity: formData.severity,
      latitude: selectedLocation.latitude,
      longitude: selectedLocation.longitude,
      evidenceImageDataUrl: evidencePreview
    })
      .then(() => {
        setFormData(initialState);
        setEvidencePreview('');
        setEvidenceName('');
        setSuccessMessage(
          'Solicitud enviada. Queda pendiente de aprobacion en el panel de administrador.'
        );
      })
      .catch((submitError) =>
        setError(submitError.message || 'No se pudo enviar la solicitud de reporte.')
      );
  };

  return (
    <div className="card report-card">
      <div className="card-body">
        <h5 className="card-title panel-heading mb-1">Reportar accidente</h5>
        <p className="text-muted mb-2">
          Selecciona el punto en el mapa, adjunta evidencia y envia la solicitud para revision.
        </p>
        {error && <div className="alert alert-danger py-2">{error}</div>}
        {successMessage && <div className="alert alert-success py-2">{successMessage}</div>}

        <form className="row g-3" onSubmit={handleSubmit}>
          <div className="col-12">
            <label className="form-label filter-label">Ubicacion seleccionada</label>
            <div className="form-control bg-light">{locationLabel}</div>
          </div>

          <div className="col-12 d-flex flex-wrap gap-2">
            {!isPickingLocation && (
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={onStartMapPick}
              >
                Seleccionar punto en mapa
              </button>
            )}
            {isPickingLocation && (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={onCancelMapPick}
              >
                Cancelar seleccion de punto
              </button>
            )}
            {isPickingLocation && (
              <small className="text-muted align-self-center">
                Haz click en el mapa para fijar la ubicacion del accidente.
              </small>
            )}
          </div>

          <div className="col-12">
            <label className="form-label filter-label">Descripcion</label>
            <textarea
              className="form-control"
              name="description"
              rows={3}
              value={formData.description}
              onChange={handleChange}
              placeholder="Choque leve en avenida principal"
            />
          </div>

          <div className="col-12 col-md-5">
            <label className="form-label filter-label">Severidad</label>
            <select
              className="form-select"
              name="severity"
              value={formData.severity}
              onChange={handleChange}
            >
              <option value="alta">Alta</option>
              <option value="media">Media</option>
              <option value="baja">Baja</option>
            </select>
          </div>

          <div className="col-12 col-md-7">
            <label className="form-label filter-label">Foto evidencia</label>
            <input
              className="form-control"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleEvidenceChange}
            />
            {evidenceName && <small className="text-muted d-block mt-1">Archivo: {evidenceName}</small>}
          </div>

          {evidencePreview && (
            <div className="col-12">
              <img src={evidencePreview} alt="Vista previa evidencia" className="report-evidence-preview" />
            </div>
          )}

          <div className="col-12 d-flex justify-content-end">
            <button type="submit" className="btn btn-primary px-4" disabled={submitting}>
              {submitting ? 'Enviando...' : 'Enviar solicitud'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
