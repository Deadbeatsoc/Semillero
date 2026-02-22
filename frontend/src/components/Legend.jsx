import React from 'react';

export default function Legend() {
  return (
    <div className="card border-0 shadow-sm">
      <div className="card-body">
        <h6 className="text-uppercase text-muted small mb-3">Leyenda del mapa</h6>
        <div className="d-flex flex-column gap-3">
          <div className="d-flex align-items-center gap-3">
            <span className="badge rounded-pill bg-danger text-white px-3">Riesgo alto</span>
            <small className="text-muted">Probabilidad mayor o igual a 0.75</small>
          </div>
          <div className="d-flex align-items-center gap-3">
            <span className="badge rounded-pill bg-warning text-dark px-3">Riesgo medio</span>
            <small className="text-muted">Probabilidad entre 0.55 y 0.74</small>
          </div>
          <div className="d-flex align-items-center gap-3">
            <span className="badge rounded-pill bg-success text-white px-3">Riesgo bajo</span>
            <small className="text-muted">Probabilidad menor a 0.55</small>
          </div>
          <div className="d-flex align-items-center gap-3">
            <span className="badge rounded-pill bg-primary text-white px-3">Sombra hotspot</span>
            <small className="text-muted">Zona principal del filtro aplicado en el mapa</small>
          </div>
          <div className="d-flex align-items-center gap-3">
            <span className="badge rounded-pill bg-dark text-white px-3">Reporte</span>
            <small className="text-muted">Incidente reportado por usuarios</small>
          </div>
        </div>
      </div>
    </div>
  );
}
