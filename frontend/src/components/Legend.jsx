import React from 'react';

export default function Legend() {
  return (
    <div className="card border-0 shadow-sm">
      <div className="card-body">
        <h6 className="text-uppercase text-muted small mb-3">Leyenda</h6>
        <div className="d-flex flex-column gap-3">
          <div className="d-flex align-items-center gap-3">
            <span className="badge rounded-pill bg-danger text-white px-3">Alto riesgo</span>
            <small className="text-muted">Predicción de IA &gt; 0.75</small>
          </div>
          <div className="d-flex align-items-center gap-3">
            <span className="badge rounded-pill bg-warning text-dark px-3">Riesgo medio</span>
            <small className="text-muted">Predicción de IA 0.55 – 0.75</small>
          </div>
          <div className="d-flex align-items-center gap-3">
            <span className="badge rounded-pill bg-success text-white px-3">Riesgo bajo</span>
            <small className="text-muted">Predicción de IA &lt; 0.55</small>
          </div>
          <div className="d-flex align-items-center gap-3">
            <span className="badge rounded-pill bg-dark text-white px-3">Reporte ciudadano</span>
            <small className="text-muted">Incidente enviado por un usuario</small>
          </div>
        </div>
      </div>
    </div>
  );
}
