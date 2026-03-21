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

const inferPeriodFromHour = (hourInput) => {
  if (!hourInput) {
    return '';
  }
  const [hourToken] = String(hourInput).split(':');
  const hour = Number.parseInt(hourToken, 10);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
    return '';
  }
  return hour >= 6 && hour < 18 ? 'dia' : 'noche';
};

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
  loading,
  weatherForecastData,
  weatherForecastLoading,
  weatherAutoMessage
}) {
  const [addressFocused, setAddressFocused] = useState(false);
  const [weatherModalOpen, setWeatherModalOpen] = useState(false);

  const forecastDaily = Array.isArray(weatherForecastData?.daily) ? weatherForecastData.daily : [];
  const forecastTopHourly = Array.isArray(weatherForecastData?.topHourly)
    ? weatherForecastData.topHourly
    : [];
  const forecastRange = weatherForecastData?.range || null;

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

    if (name === 'hour') {
      onFilterChange({
        ...filters,
        hour: value,
        period: value ? 'todos' : filters.period
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
  const inferredPeriod = inferPeriodFromHour(filters.hour);
  const hasHourSelected = Boolean(inferredPeriod);
  const inferredPeriodLabel = inferredPeriod === 'dia' ? 'Dia' : inferredPeriod === 'noche' ? 'Noche' : '';

  return (
    <div className="card filters-card mb-4">
      <div className="card-body">
        <div className="mb-4 d-flex flex-column flex-lg-row gap-3 justify-content-between">
          <div>
            <h5 className="card-title panel-heading mb-1">Prediccion de accidentes</h5>
            <p className="panel-subtitle text-muted mb-0">
              Organiza los filtros por tipo de dato y aplica al final.
            </p>
          </div>
          <div className="weather-inline-trigger">
            <span className="weather-inline-label">Clima de los proximos dias</span>
            <button
              type="button"
              className="weather-inline-button"
              onClick={() => setWeatherModalOpen(true)}
              aria-label="Ver detalle del pronostico del clima"
              title="Ver detalle del pronostico del clima"
            >
              !
            </button>
          </div>
        </div>
        {weatherAutoMessage && <div className="weather-auto-alert mb-3">{weatherAutoMessage}</div>}

        <section className="filter-section">
          <h6 className="filter-section-title mb-3">Ubicacion</h6>
          <div className="row g-3">
            <div className="col-12 col-md-4 col-lg-3">
              <label className="form-label filter-label">Ciudad</label>
              <select className="form-select" name="city" value={filters.city} onChange={handleChange}>
                {cities.map((city) => (
                  <option key={city.key} value={city.key}>
                    {city.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-12 col-md-8 col-lg-9 position-relative">
              <label className="form-label filter-label">Direccion</label>
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
          </div>
          <div className="mt-3 d-flex flex-column flex-md-row align-items-md-center gap-2">
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
        </section>

        <section className="filter-section mt-3">
          <h6 className="filter-section-title mb-3">Fecha y hora</h6>
          <div className="row g-3">
            <div className="col-12 col-md-6 col-lg-3">
              <label className="form-label filter-label">Modo temporal</label>
              <select className="form-select" name="rangeMode" value={filters.rangeMode} onChange={handleChange}>
                {rangeModeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            {!isRangeModeActive && (
              <div className="col-12 col-md-6 col-lg-3">
                <label className="form-label filter-label">Fecha</label>
                <input className="form-control" type="date" name="date" value={filters.date} onChange={handleChange} />
              </div>
            )}
            {isRangeByDay && (
              <>
                <div className="col-12 col-md-6 col-lg-3">
                  <label className="form-label filter-label">Inicio (dia)</label>
                  <input
                    className="form-control"
                    type="date"
                    name="rangeStart"
                    value={filters.rangeStart}
                    onChange={handleChange}
                  />
                </div>
                <div className="col-12 col-md-6 col-lg-3">
                  <label className="form-label filter-label">Fin (dia)</label>
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
                <div className="col-12 col-md-6 col-lg-3">
                  <label className="form-label filter-label">Inicio (mes)</label>
                  <input
                    className="form-control"
                    type="month"
                    name="rangeStart"
                    value={filters.rangeStart}
                    onChange={handleChange}
                  />
                </div>
                <div className="col-12 col-md-6 col-lg-3">
                  <label className="form-label filter-label">Fin (mes)</label>
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
            <div className="col-12 col-md-6 col-lg-3">
              <label className="form-label filter-label">Hora</label>
              <input className="form-control" type="time" name="hour" value={filters.hour} onChange={handleChange} />
            </div>
            {!hasHourSelected && (
              <div className="col-12 col-md-6 col-lg-3">
                <label className="form-label filter-label">Periodo</label>
                <select className="form-select" name="period" value={filters.period} onChange={handleChange}>
                  {periodOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {hasHourSelected && (
              <div className="col-12 col-md-6 col-lg-3">
                <label className="form-label filter-label">Periodo detectado</label>
                <div className="form-control bg-light fw-semibold">{`${inferredPeriodLabel} (automatico)`}</div>
              </div>
            )}
          </div>
          {rangeIncomplete && (
            <div className="mt-2 text-muted small">Completa fecha/mes inicio y fin para aplicar el rango.</div>
          )}
          {hasHourSelected && (
            <div className="mt-2 text-muted small">
              Al seleccionar hora, el periodo se calcula automaticamente para evitar filtros redundantes.
            </div>
          )}
        </section>

        <section className="filter-section mt-3">
          <h6 className="filter-section-title mb-3">Condiciones</h6>
          <div className="row g-3">
            <div className="col-12 col-md-6 col-lg-3">
              <label className="form-label filter-label">Clima</label>
              <select className="form-select" name="weather" value={filters.weather} onChange={handleChange}>
                {weatherOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <div className="filter-actions d-flex flex-column flex-sm-row justify-content-sm-end gap-2 mt-4 pt-3 border-top">
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

        {loading && (
          <div className="d-flex align-items-center gap-2 mt-3 text-primary">
            <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
            <span>Calculando hotspots y probabilidad...</span>
          </div>
        )}

        {weatherModalOpen && (
          <div className="weather-modal-backdrop" onClick={() => setWeatherModalOpen(false)}>
            <div
              className="weather-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Detalle del pronostico del clima"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="weather-modal-header">
                <h6 className="mb-0">Clima de los proximos dias</h6>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => setWeatherModalOpen(false)}
                >
                  Cerrar
                </button>
              </div>

              {weatherForecastLoading && (
                <div className="text-muted small mt-2">Consultando datos del servicio de clima...</div>
              )}

              {!weatherForecastLoading && forecastDaily.length === 0 && (
                <div className="text-muted small mt-2">No hay datos de pronostico disponibles.</div>
              )}

              {!weatherForecastLoading && forecastDaily.length > 0 && (
                <div className="d-flex flex-column gap-3 mt-2">
                  <div className="weather-modal-section">
                    <strong>Rango del pronostico</strong>
                    <div className="text-muted small">
                      {forecastRange?.startDate || 'N/A'} a {forecastRange?.endDate || 'N/A'} (
                      {forecastRange?.totalDays || 0} dias)
                    </div>
                  </div>

                  <div className="weather-modal-section">
                    <strong>Horas con mayor probabilidad (global)</strong>
                    <div className="d-flex flex-column gap-1 mt-1">
                      {forecastTopHourly.length === 0 && (
                        <div className="text-muted small">Sin horas destacadas.</div>
                      )}
                      {forecastTopHourly.map((entry) => (
                        <div key={entry.time} className="weather-modal-row">
                          <span>{entry.time.replace('T', ' ')}</span>
                          <strong>
                            {Math.round(Number(entry.precipitationProbability) || 0)}% |{' '}
                            {Number(Number(entry.precipMm) || 0).toFixed(2)} mm
                          </strong>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="weather-modal-section">
                    <strong>Detalle por dia</strong>
                    <div className="d-flex flex-column gap-2 mt-1">
                      {forecastDaily.map((day) => (
                        <div key={day.date} className="weather-modal-day">
                          <div className="weather-modal-row">
                            <span>{day.date}</span>
                            <strong>Max {Math.round(Number(day.maxPrecipitationProbability) || 0)}%</strong>
                          </div>
                          <div className="text-muted small">
                            Hora pico: {day.peakHour || 'N/A'} | Promedio:{' '}
                            {Math.round(Number(day.avgPrecipitationProbability) || 0)}%
                          </div>
                          {Array.isArray(day.topHours) && day.topHours.length > 0 && (
                            <div className="text-muted small">
                              Top horas:{' '}
                              {day.topHours
                                .map(
                                  (hourEntry) =>
                                    `${hourEntry.time} (${Math.round(
                                      Number(hourEntry.precipitationProbability) || 0
                                    )}% - ${Number(Number(hourEntry.precipMm) || 0).toFixed(2)} mm)`
                                )
                                .join(' | ')}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
