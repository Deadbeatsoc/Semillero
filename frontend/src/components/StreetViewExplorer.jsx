import { useMemo, useState } from 'react';

const viewpoints = [
  {
    id: 'parque-los-libertadores',
    name: 'Parque Los Libertadores',
    latitude: 4.142438,
    longitude: -73.629347,
    heading: 120,
    pitch: 0,
    fov: 75
  },
  {
    id: 'parque-de-las-banderas',
    name: 'Parque de las Banderas',
    latitude: 4.141215,
    longitude: -73.621954,
    heading: 290,
    pitch: -5,
    fov: 75
  },
  {
    id: 'catedral-nuestra-senora',
    name: 'Catedral Nuestra Señora del Carmen',
    latitude: 4.143559,
    longitude: -73.629793,
    heading: 35,
    pitch: 0,
    fov: 75
  },
  {
    id: 'parque-las-malocas',
    name: 'Parque Las Malocas',
    latitude: 4.099768,
    longitude: -73.609584,
    heading: 15,
    pitch: 0,
    fov: 75
  }
];

const filters = [
  { id: 'normal', label: 'Normal', css: 'none' },
  { id: 'calido', label: 'Cálido', css: 'sepia(0.3) saturate(1.15)' },
  { id: 'nocturno', label: 'Nocturno', css: 'brightness(0.7) contrast(1.2) saturate(0.8)' },
  { id: 'retro', label: 'Retro', css: 'grayscale(0.5) sepia(0.4) contrast(1.1)' },
  { id: 'frio', label: 'Frío', css: 'saturate(0.8) hue-rotate(170deg) brightness(1.05)' }
];

const buildStreetViewUrl = ({ latitude, longitude, heading, pitch, fov }) =>
  `https://maps.google.com/maps?q=&layer=c&cbll=${latitude},${longitude}&cbp=12,${heading},,${pitch},${fov}&hl=es&ie=UTF8&hq=&hnear=&ll=${latitude},${longitude}&spn=0.001,0.002&t=m&z=17&output=svembed`;

export default function StreetViewExplorer() {
  const [selectedViewpoint, setSelectedViewpoint] = useState(viewpoints[0]);
  const [selectedFilter, setSelectedFilter] = useState(filters[0]);

  const streetViewUrl = useMemo(() => buildStreetViewUrl(selectedViewpoint), [selectedViewpoint]);

  return (
    <div className="card border-0 shadow-sm streetview-card mt-4">
      <div className="card-body">
        <div className="d-flex flex-column flex-lg-row align-items-lg-center justify-content-lg-between gap-3 mb-3">
          <div>
            <h5 className="mb-1">Recorre Villavicencio en 360°</h5>
            <p className="text-muted small mb-0">
              Explora puntos emblemáticos de la ciudad con Street View y aplica filtros para simular diferentes ambientes.
            </p>
          </div>
          <div className="d-flex flex-column flex-sm-row gap-2 align-items-stretch align-items-sm-center">
            <select
              className="form-select"
              value={selectedViewpoint.id}
              onChange={(event) => {
                const next = viewpoints.find((item) => item.id === event.target.value);
                setSelectedViewpoint(next ?? viewpoints[0]);
              }}
            >
              {viewpoints.map((viewpoint) => (
                <option key={viewpoint.id} value={viewpoint.id}>
                  {viewpoint.name}
                </option>
              ))}
            </select>
            <select
              className="form-select"
              value={selectedFilter.id}
              onChange={(event) => {
                const next = filters.find((item) => item.id === event.target.value);
                setSelectedFilter(next ?? filters[0]);
              }}
            >
              {filters.map((filter) => (
                <option key={filter.id} value={filter.id}>
                  {filter.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="streetview-frame rounded-4 overflow-hidden">
          <iframe
            key={streetViewUrl}
            title="Street View Villavicencio"
            src={streetViewUrl}
            allowFullScreen
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            style={{ filter: selectedFilter.css }}
          />
        </div>
        <div className="text-muted small mt-2">
          Vista cortesía de Google Street View. Algunos filtros aplican efectos visuales para simular distintas condiciones de
          iluminación.
        </div>
      </div>
    </div>
  );
}
