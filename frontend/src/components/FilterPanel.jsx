import React from 'react';

const weatherOptions = [
  { value: 'todos', label: 'Todas' },
  { value: 'lluvia', label: 'Lluvia' },
  { value: 'no_lluvia', label: 'Sin lluvia' }
];

const periodOptions = [
  { value: 'todos', label: 'Todo el día' },
  { value: 'dia', label: 'Día' },
  { value: 'noche', label: 'Noche' }
];

export default function FilterPanel({ filters, onFilterChange, onReset, loading }) {
  const handleChange = (event) => {
    const { name, value } = event.target;
    onFilterChange({ ...filters, [name]: value });
  };

  return (
    <div className="card filters-card mb-4">
      <div className="card-body">
        <div className="d-flex align-items-center justify-content-between mb-3">
          <div>
            <h5 className="card-title mb-0">Predicción de accidentes</h5>
            <small className="text-muted">Refina la predicción usando los filtros disponibles</small>
          </div>
          <button type="button" className="btn btn-outline-primary btn-sm" onClick={onReset}>
            Limpiar filtros
          </button>
        </div>
        <div className="row g-3">
          <div className="col-12 col-md-3">
            <label className="form-label fw-semibold text-uppercase text-muted small">Fecha</label>
            <input
              className="form-control"
              type="date"
              name="date"
              value={filters.date}
              onChange={handleChange}
            />
          </div>
          <div className="col-12 col-md-3">
            <label className="form-label fw-semibold text-uppercase text-muted small">Hora</label>
            <input
              className="form-control"
              type="time"
              name="hour"
              value={filters.hour}
              onChange={handleChange}
            />
          </div>
          <div className="col-12 col-md-3">
            <label className="form-label fw-semibold text-uppercase text-muted small">Clima</label>
            <select
              className="form-select"
              name="weather"
              value={filters.weather}
              onChange={handleChange}
            >
              {weatherOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-12 col-md-3">
            <label className="form-label fw-semibold text-uppercase text-muted small">Periodo</label>
            <select
              className="form-select"
              name="period"
              value={filters.period}
              onChange={handleChange}
            >
              {periodOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {loading && (
          <div className="d-flex align-items-center gap-2 mt-3 text-primary">
            <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
            <span>Actualizando predicciones…</span>
          </div>
        )}
      </div>
    </div>
  );
}
