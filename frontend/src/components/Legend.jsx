import React from 'react';

const legendItems = [
  {
    id: 'high-risk',
    label: 'Riesgo alto',
    badgeClassName: 'bg-danger text-white',
    description: 'Indice de riesgo mayor o igual a 0.75 (0 a 1, relativo a la ciudad)'
  },
  {
    id: 'medium-risk',
    label: 'Riesgo medio',
    badgeClassName: 'bg-warning text-dark',
    description: 'Indice de riesgo entre 0.55 y 0.74 (0 a 1, relativo a la ciudad)'
  },
  {
    id: 'low-risk',
    label: 'Riesgo bajo',
    badgeClassName: 'bg-success text-white',
    description: 'Indice de riesgo menor a 0.55 (0 a 1, relativo a la ciudad)'
  },
  {
    id: 'hotspot-shadow',
    label: 'Sombra hotspot',
    badgeClassName: 'bg-primary text-white',
    description: 'Zona principal del filtro aplicado en el mapa'
  },
  {
    id: 'query-point',
    label: 'Consulta',
    badgeClassName: 'bg-info text-dark',
    description: 'Punto elegido por direccion o click en mapa'
  },
  {
    id: 'type-severity',
    label: 'Tipo y gravedad',
    badgeClassName: 'bg-secondary text-white',
    description: 'Cada popup muestra moto/carro/peaton y severidad probable'
  },
  {
    id: 'citizen-report',
    label: 'Reporte',
    badgeClassName: 'bg-dark text-white',
    description: 'Incidente reportado por usuarios'
  }
];

export default function Legend() {
  return (
    <div className="card border-0 shadow-sm">
      <div className="card-body">
        <h6 className="panel-title mb-3">Leyenda del mapa</h6>
        <div className="d-flex flex-column gap-2">
          {legendItems.map((item) => (
            <div key={item.id} className="legend-row d-flex align-items-center justify-content-between gap-2">
              <span className={`badge rounded-pill px-3 py-2 ${item.badgeClassName}`}>{item.label}</span>
              <button type="button" className="legend-info-button" aria-label={`Informacion de ${item.label}`}>
                !
                <span role="tooltip" className="legend-tooltip">
                  {item.description}
                </span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
