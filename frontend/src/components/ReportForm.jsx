import React, { useState } from 'react';

const initialState = {
  description: '',
  latitude: '',
  longitude: '',
  severity: 'media'
};

export default function ReportForm({ onSubmit, submitting }) {
  const [formData, setFormData] = useState(initialState);
  const [error, setError] = useState('');

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((previous) => ({ ...previous, [name]: value }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    setError('');

    const latitude = Number.parseFloat(formData.latitude);
    const longitude = Number.parseFloat(formData.longitude);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setError('Ingresa coordenadas validas.');
      return;
    }

    if (!formData.description.trim()) {
      setError('La descripcion es obligatoria.');
      return;
    }

    onSubmit({
      description: formData.description,
      latitude,
      longitude,
      severity: formData.severity
    })
      .then(() => setFormData(initialState))
      .catch((submitError) => setError(submitError.message || 'No se pudo enviar el reporte.'));
  };

  return (
    <div className="card report-card">
      <div className="card-body">
        <h5 className="card-title">Reportar accidente</h5>
        <p className="text-muted">Envia un incidente para que aparezca en el mapa en tiempo real.</p>
        {error && <div className="alert alert-danger py-2">{error}</div>}
        <form className="row g-3" onSubmit={handleSubmit}>
          <div className="col-12">
            <label className="form-label fw-semibold text-uppercase text-muted small">Descripcion</label>
            <textarea
              className="form-control"
              name="description"
              rows={3}
              value={formData.description}
              onChange={handleChange}
              placeholder="Choque leve en avenida principal"
            />
          </div>
          <div className="col-12 col-md-4">
            <label className="form-label fw-semibold text-uppercase text-muted small">Latitud</label>
            <input
              className="form-control"
              name="latitude"
              value={formData.latitude}
              onChange={handleChange}
              placeholder="4.1420"
            />
          </div>
          <div className="col-12 col-md-4">
            <label className="form-label fw-semibold text-uppercase text-muted small">Longitud</label>
            <input
              className="form-control"
              name="longitude"
              value={formData.longitude}
              onChange={handleChange}
              placeholder="-73.6266"
            />
          </div>
          <div className="col-12 col-md-4">
            <label className="form-label fw-semibold text-uppercase text-muted small">Severidad</label>
            <select className="form-select" name="severity" value={formData.severity} onChange={handleChange}>
              <option value="alta">Alta</option>
              <option value="media">Media</option>
              <option value="baja">Baja</option>
            </select>
          </div>
          <div className="col-12 d-flex justify-content-end">
            <button type="submit" className="btn btn-primary px-4" disabled={submitting}>
              {submitting ? 'Enviando...' : 'Enviar reporte'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
