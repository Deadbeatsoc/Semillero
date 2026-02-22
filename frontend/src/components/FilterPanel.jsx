import React, { useState } from 'react';

const weatherOptions = [
  { value: 'todos', label: 'Todos' },
  { value: 'lluvia', label: 'Lluvia' },
  { value: 'no_lluvia', label: 'Sin lluvia' }
];

const rangeModeOptions = [
  { value: 'none', label: 'Sin rango' },
  { value: 'dia', label: 'Dia a dia' },
  { value: 'mes', label: 'Mes a mes' }
];

const periodOptions = [
  { value: 'todos', label: 'Todo el dia' },
  { value: 'dia', label: 'Dia' },
  { value: 'noche', label: 'Noche' }
];

export default function FilterPanel({
  filters,
  cities,
  onFilterChange,
  onAddressChange,
  addressSuggestions,
  onAddressSuggestionSelect,
  onToggleMapPick,
  isPickingOnMap,
  onApply,
  onReset,
  loading
}) {
  const [addressFocused, setAddressFocused] = useState(false);

  const handleChange = (event) => {
    const { name, value } = event.target;
    if (name === 'rangeMode') {
      if (value === 'none') {
        onFilterChange({
          ...filters,
          rangeMode: value,
          rangeStart: '',
          rangeEnd: ''
        });
        return;
      }

      onFilterChange({
        ...filters,
        rangeMode: value,
        date: ''
      });
      return;
    }

    onFilterChange({
      ...filters,
      [name]: value
    });
  };

  const handleAddressInput = (event) => {
    onAddressChange(event.target.value);
  };

  const showSuggestions =
    filters.rangeMode === 'none' &&
    addressFocused &&
    Array.isArray(addressSuggestions) &&
    addressSuggestions.length > 0 &&
    filters.address.trim().length >= 3;
  const isRangeModeActive = filters.rangeMode && filters.rangeMode !== 'none';
  const isRangeByDay = filters.rangeMode === 'dia';
  const isRangeByMonth = filters.rangeMode === 'mes';
  const rangeIncomplete = isRangeModeActive && (!filters.rangeStart || !filters.rangeEnd);

  return (
    <div className="card filters-card mb-4">
      <div className="card-body">
        <div className="d-flex align-items-center justify-content-between mb-3">
          <div>
            <h5 className="card-title mb-0">Prediccion de accidentes</h5>
            <small className="text-muted">
              Consulta puntual por direccion o analiza zonas graves por rango de fechas.
            </small>
          </div>
          <div className="d-flex align-items-center gap-2">
            <button type="button" className="btn btn-outline-primary btn-sm" onClick={onReset}>
              Limpiar
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onApply}
              disabled={loading || rangeIncomplete}
            >
              Aplicar filtros
            </button>
          </div>
        </div>
        <div className="row g-3">
          <div className="col-12 col-lg-4 position-relative">
            <label className="form-label fw-semibold text-uppercase text-muted small">Direccion</label>
            <input
              className="form-control"
              name="address"
              value={filters.address}
              onChange={handleAddressInput}
              onFocus={() => setAddressFocused(true)}
              onBlur={() => setTimeout(() => setAddressFocused(false), 120)}
              placeholder="Carrera 50 A"
              disabled={isRangeModeActive}
            />
            {showSuggestions && (
              <div className="list-group position-absolute w-100 shadow-sm mt-1" style={{ zIndex: 1000 }}>
                {addressSuggestions.map((suggestion) => (
                  <button
                    type="button"
                    key={suggestion.id}
                    className="list-group-item list-group-item-action text-start"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      onAddressSuggestionSelect(suggestion);
                    }}
                  >
                    <div className="fw-semibold">{suggestion.label}</div>
                    <small className="text-muted">{suggestion.displayName}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="col-12 col-md-4 col-lg-2">
            <label className="form-label fw-semibold text-uppercase text-muted small">Ciudad</label>
            <select className="form-select" name="city" value={filters.city} onChange={handleChange}>
              {cities.map((city) => (
                <option key={city.key} value={city.key}>
                  {city.label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-6 col-md-4 col-lg-2">
            <label className="form-label fw-semibold text-uppercase text-muted small">Modo temporal</label>
            <select className="form-select" name="rangeMode" value={filters.rangeMode} onChange={handleChange}>
              {rangeModeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          {!isRangeModeActive && (
            <div className="col-6 col-md-4 col-lg-2">
              <label className="form-label fw-semibold text-uppercase text-muted small">Fecha</label>
              <input className="form-control" type="date" name="date" value={filters.date} onChange={handleChange} />
            </div>
          )}
          {isRangeByDay && (
            <>
              <div className="col-6 col-md-4 col-lg-2">
                <label className="form-label fw-semibold text-uppercase text-muted small">Inicio (dia)</label>
                <input
                  className="form-control"
                  type="date"
                  name="rangeStart"
                  value={filters.rangeStart}
                  onChange={handleChange}
                />
              </div>
              <div className="col-6 col-md-4 col-lg-2">
                <label className="form-label fw-semibold text-uppercase text-muted small">Fin (dia)</label>
                <input
                  className="form-control"
                  type="date"
                  name="rangeEnd"
                  value={filters.rangeEnd}
                  onChange={handleChange}
                />
              </div>
            </>
          )}
          {isRangeByMonth && (
            <>
              <div className="col-6 col-md-4 col-lg-2">
                <label className="form-label fw-semibold text-uppercase text-muted small">Inicio (mes)</label>
                <input
                  className="form-control"
                  type="month"
                  name="rangeStart"
                  value={filters.rangeStart}
                  onChange={handleChange}
                />
              </div>
              <div className="col-6 col-md-4 col-lg-2">
                <label className="form-label fw-semibold text-uppercase text-muted small">Fin (mes)</label>
                <input
                  className="form-control"
                  type="month"
                  name="rangeEnd"
                  value={filters.rangeEnd}
                  onChange={handleChange}
                />
              </div>
            </>
          )}
          <div className="col-6 col-md-4 col-lg-2">
            <label className="form-label fw-semibold text-uppercase text-muted small">Hora</label>
            <input className="form-control" type="time" name="hour" value={filters.hour} onChange={handleChange} />
          </div>
          <div className="col-6 col-md-6 col-lg-1">
            <label className="form-label fw-semibold text-uppercase text-muted small">Clima</label>
            <select className="form-select" name="weather" value={filters.weather} onChange={handleChange}>
              {weatherOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-6 col-md-6 col-lg-1">
            <label className="form-label fw-semibold text-uppercase text-muted small">Periodo</label>
            <select className="form-select" name="period" value={filters.period} onChange={handleChange}>
              {periodOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3 d-flex align-items-center gap-2">
          <button
            type="button"
            className={`btn btn-sm ${isPickingOnMap ? 'btn-danger' : 'btn-outline-secondary'}`}
            onClick={onToggleMapPick}
            disabled={isRangeModeActive}
          >
            {isPickingOnMap ? 'Cancelar seleccion en mapa' : 'Seleccionar ubicacion en mapa'}
          </button>
          {isRangeModeActive && (
            <small className="text-muted">En modo rango se analiza la ciudad completa por severidad.</small>
          )}
          {isPickingOnMap && (
            <small className="text-muted">
              Haz click en el mapa para cargar automaticamente la direccion en la barra.
            </small>
          )}
        </div>
        {rangeIncomplete && (
          <div className="mt-2 text-muted small">Completa fecha/mes inicio y fin para aplicar el rango.</div>
        )}
        {loading && (
          <div className="d-flex align-items-center gap-2 mt-3 text-primary">
            <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
            <span>Calculando hotspots y probabilidad...</span>
          </div>
        )}
      </div>
    </div>
  );
}
