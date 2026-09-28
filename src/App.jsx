
import React, { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import "leaflet/dist/leaflet.css";
import "./App.css";
 
const SHEET_ID =
  import.meta.env.VITE_SHEET_ID || "1g_yC9QSNLTKN_HHlxLUkv9jSVhx3KpRfG5C2C1AL4xI";
 
const SHEETS = {
  proyectos: "PROYECTOS",
  adoptantes: "ADOPTANTES",
};
 
const DEFAULT_CENTER = [-32.41, -63.24];
 const ARGENMAP_URL =
  "https://wms.ign.gob.ar/geoserver/gwc/service/tms/1.0.0/capabaseargenmap@EPSG%3A3857@png/{z}/{x}/{-y}.png";
 
const TYPE_COLORS = {
  Universidad: "#003A8F",
  Universidades: "#003A8F",
  Municipalidad: "#16A34A",
  Municipio: "#16A34A",
  "Gobierno provincial": "#0F766E",
  Empresa: "#EA580C",
  "Empresa de software": "#EA580C",
  "Empresa de bioinsumos": "#EA580C",
  Empresas: "#EA580C",
  Fundación: "#7C3AED",
  "Asociación civil": "#DB2777",
  Cooperativa: "#CA8A04",
  Gimnasio: "#0891B2",
  Laboratorio: "#2563EB",
  "Laboratorio privado": "#2563EB",
  "Obra Social": "#DC2626",
  "Entidad educativa": "#9333EA",
  "Comunidad regional": "#65A30D",
  "Entidad asociativa sin fines de lucro": "#9333EA",
  "Agrupación musical autogestiva e independiente": "#C026D3",
};
 
const FALLBACK_COORDS = {
  "Villa María": [-32.4103, -63.2403],
  Córdoba: [-31.4201, -64.1888],
  "Río Cuarto": [-33.1248, -64.3499],
  "Mar del Plata": [-38.0055, -57.5426],
  Montevideo: [-34.9011, -56.1645],
  Malagueño: [-31.4647, -64.3593],
  Sunchales: [-30.9457, -61.5615],
  Idiazabal: [-32.815, -63.032],
  "Villa Ascasubi": [-32.1625, -63.8947],
  Paraná: [-31.7413, -60.5115],
};
 
function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}
 
function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
 
// Los códigos (PH1, PH2...) se repiten entre períodos,
// por eso el proyecto se identifica siempre con PERIODO + CODIGO.
function makeKey(periodo, codigo) {
  return `${clean(periodo)}|${clean(codigo)}`;
}
 
// Nombres de columna esperados (en orden) por si Google no devuelve los encabezados.
const EXPECTED_COLUMNS = {
  PROYECTOS: ["PERIODO", "AREA", "CODIGO", "TITULO", "DIRECTOR", "DESCRIPCION", "PERSONAS"],
  ADOPTANTES: ["PERIODO", "CODIGO_PROYECTO", "ADOPTANTE", "TIPO", "LOCALIDAD", "PROVINCIA", "PAIS", "LAT", "LON"],
};
 
function headerKey(value) {
  return normalize(value).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
 
// Convierte la respuesta de Google en objetos { PERIODO, CODIGO, ... }.
// Cuando una hoja tiene columnas vacías o solo texto, Google no detecta la fila de
// encabezados: devuelve las etiquetas vacías y los encabezados como primera fila de datos.
function parseGviz(text, sheetName) {
  const json = JSON.parse(
    text.substring(text.indexOf("{"), text.lastIndexOf("}") + 1)
  );
 
  const expected = EXPECTED_COLUMNS[sheetName] || [];
  const cols = json.table.cols;
  let rows = json.table.rows.map((row) =>
    cols.map((_, index) => row.c?.[index]?.v ?? "")
  );
 
  let headers = cols.map((col) => headerKey(col.label));
  const labelsFound = headers.filter((h) => expected.includes(h)).length;
 
  if (labelsFound < 2 && rows.length) {
    // La primera fila trae los encabezados.
    const firstRow = rows[0].map(headerKey);
    if (firstRow.filter((h) => expected.includes(h)).length >= 2) {
      headers = firstRow;
      rows = rows.slice(1);
    } else {
      // Último recurso: usar el orden esperado de columnas.
      headers = expected;
    }
  }
 
  return rows.map((values) => {
    const item = {};
    headers.forEach((name, index) => {
      if (name) item[name] = values[index] ?? "";
    });
    return item;
  });
}
 
async function fetchSheet(sheetName) {
  if (!SHEET_ID) {
    throw new Error("Falta configurar VITE_SHEET_ID.");
  }
 
  const url =
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq` +
    `?tqx=out:json&headers=1&sheet=${encodeURIComponent(sheetName)}`;
 
  const response = await fetch(url);
 
  if (!response.ok) {
    throw new Error(`No se pudo consultar la hoja ${sheetName}.`);
  }
 
  const text = await response.text();
 
  if (!text.includes("google.visualization.Query.setResponse")) {
    throw new Error(
      "Google no devolvió datos. Revisá que el Sheet sea público (cualquier persona con el enlace) y que las pestañas se llamen PROYECTOS y ADOPTANTES."
    );
  }
 
  return parseGviz(text, sheetName);
}
 
function makeIcon(type) {
  const color = TYPE_COLORS[type] || "#475569";
 
  return L.divIcon({
    className: "peidi-marker-wrapper",
    html: `
      <div class="peidi-marker" style="--marker-color:${color}">
        <span></span>
      </div>
    `,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -14],
  });
}
 
function toNumber(value) {
  if (value === "" || value === null || value === undefined) return NaN;
  return Number(String(value).replace(",", "."));
}
 
function getCoordinates(row) {
  const lat = toNumber(row.LAT);
  const lon = toNumber(row.LON);
 
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return [lat, lon];
  }
 
  const locality = clean(row.LOCALIDAD);
  const fallback =
    FALLBACK_COORDS[locality] ||
    Object.entries(FALLBACK_COORDS).find(([key]) =>
      normalize(locality).includes(normalize(key))
    )?.[1];
 
  return fallback || null;
}
 
function FitMap({ points }) {
  const map = useMap();
 
  useEffect(() => {
    if (!points.length) return;
 
    const bounds = L.latLngBounds(points.map((point) => point.position));
 
    if (bounds.isValid()) {
      map.fitBounds(bounds, {
        padding: [35, 35],
        maxZoom: 10,
      });
    }
  }, [map, points]);
 
  return null;
}
 
function StatCard({ label, value, detail }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {detail && <div className="stat-detail">{detail}</div>}
    </div>
  );
}
 
function App() {
  const [projects, setProjects] = useState([]);
  const [adopters, setAdopters] = useState([]);
  const [period, setPeriod] = useState("TODOS");
  const [projectKey, setProjectKey] = useState("TODOS"); // formato "PERIODO|CODIGO"
  const [type, setType] = useState("TODOS");
  const [locality, setLocality] = useState("TODAS");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
 
  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        setError("");
 
        const [projectRows, adopterRows] = await Promise.all([
          fetchSheet(SHEETS.proyectos),
          fetchSheet(SHEETS.adoptantes),
        ]);
 
        if (!projectRows.some((row) => clean(row.CODIGO))) {
          throw new Error(
            "La hoja PROYECTOS se leyó, pero no se encontró la columna CODIGO. Columnas detectadas: " +
              Object.keys(projectRows[0] || {}).join(", ")
          );
        }
 
        setProjects(
          projectRows
            .filter((row) => clean(row.CODIGO))
            .map((row) => ({
              periodo: clean(row.PERIODO),
              area: clean(row.AREA),
              codigo: clean(row.CODIGO),
              titulo: clean(row.TITULO),
              director: clean(row.DIRECTOR),
              descripcion: clean(row.DESCRIPCION),
              personas: clean(row.PERSONAS),
            }))
        );
 
        setAdopters(
          adopterRows
            .filter((row) => clean(row.CODIGO_PROYECTO) && clean(row.ADOPTANTE))
            .map((row, index) => {
              const normalized = {
                id: `${clean(row.PERIODO)}-${clean(row.CODIGO_PROYECTO)}-${index}`,
                periodo: clean(row.PERIODO),
                codigo: clean(row.CODIGO_PROYECTO),
                adoptante: clean(row.ADOPTANTE),
                tipo: clean(row.TIPO),
                localidad: clean(row.LOCALIDAD),
                provincia: clean(row.PROVINCIA),
                pais: clean(row.PAIS),
                LAT: row.LAT,
                LON: row.LON,
                LOCALIDAD: row.LOCALIDAD,
              };
 
              return {
                ...normalized,
                position: getCoordinates(normalized),
              };
            })
            .filter((row) => row.position)
        );
      } catch (err) {
        setError(err.message || "Ocurrió un error cargando los datos.");
      } finally {
        setLoading(false);
      }
    }
 
    loadData();
  }, []);
 
  const periods = useMemo(
    () => [
      "TODOS",
      ...Array.from(new Set(projects.map((p) => p.periodo).filter(Boolean))).sort(),
    ],
    [projects]
  );
 
  const projectOptions = useMemo(
    () =>
      period === "TODOS" ? projects : projects.filter((p) => p.periodo === period),
    [projects, period]
  );
 
  const typeOptions = useMemo(() => {
    const values = adopters.map((a) => a.tipo).filter(Boolean);
    return [
      "TODOS",
      ...Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, "es")),
    ];
  }, [adopters]);
 
  const localityOptions = useMemo(() => {
    const values = adopters.map((a) => a.localidad).filter(Boolean);
    return [
      "TODAS",
      ...Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, "es")),
    ];
  }, [adopters]);
 
  const filteredAdopters = useMemo(() => {
    const query = normalize(search);
 
    return adopters.filter((a) => {
      const matchesPeriod = period === "TODOS" || a.periodo === period;
      const matchesProject =
        projectKey === "TODOS" || makeKey(a.periodo, a.codigo) === projectKey;
      const matchesType = type === "TODOS" || a.tipo === type;
      const matchesLocality = locality === "TODAS" || a.localidad === locality;
 
      const searchable = normalize(
        `${a.adoptante} ${a.localidad} ${a.provincia} ${a.tipo} ${a.codigo}`
      );
 
      const matchesSearch = !query || searchable.includes(query);
 
      return (
        matchesPeriod &&
        matchesProject &&
        matchesType &&
        matchesLocality &&
        matchesSearch
      );
    });
  }, [adopters, period, projectKey, type, locality, search]);
 
  const visibleProjects = useMemo(() => {
    const keys = new Set(filteredAdopters.map((a) => makeKey(a.periodo, a.codigo)));
 
    return projects.filter((p) => keys.has(makeKey(p.periodo, p.codigo)));
  }, [projects, filteredAdopters]);
 
  const projectMap = useMemo(
    () => new Map(projects.map((p) => [makeKey(p.periodo, p.codigo), p])),
    [projects]
  );
 
  // Cambia cada vez que cambia el resultado filtrado; fuerza a redibujar el clúster.
  const clusterKey = useMemo(
    () => filteredAdopters.map((a) => a.id).join(","),
    [filteredAdopters]
  );
 
  const localityData = useMemo(() => {
    const counts = {};
    filteredAdopters.forEach((a) => {
      const key = a.localidad || "Sin localidad";
      counts[key] = (counts[key] || 0) + 1;
    });
 
    return Object.entries(counts)
      .map(([localidad, cantidad]) => ({ localidad, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 10);
  }, [filteredAdopters]);
 
  const typeData = useMemo(() => {
    const counts = {};
    filteredAdopters.forEach((a) => {
      const key = a.tipo || "Sin tipo";
      counts[key] = (counts[key] || 0) + 1;
    });
 
    return Object.entries(counts)
      .map(([tipo, cantidad]) => ({ tipo, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad);
  }, [filteredAdopters]);
 
  const uniqueProjects = new Set(
    filteredAdopters.map((a) => makeKey(a.periodo, a.codigo))
  ).size;
 
  const uniqueLocalities = new Set(
    filteredAdopters.map((a) => a.localidad).filter(Boolean)
  ).size;
 
  const uniqueTypes = new Set(filteredAdopters.map((a) => a.tipo).filter(Boolean))
    .size;
 
  function resetFilters() {
    setPeriod("TODOS");
    setProjectKey("TODOS");
    setType("TODOS");
    setLocality("TODAS");
    setSearch("");
  }
 
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img
            src="/PEIDI.jpeg"
            alt="OEIDI"
            style={{ height: "80px", width: "auto", objectFit: "contain",
              borderRadius: "10px",
              border: "1px solid var(--border)" }}
          />
          <div>
            <h1>Adoptantes PEIDI</h1>
            <p>Mapa de vinculación Universidad – Medio</p>
          </div>
        </div>
 
        <div className="topbar-right">
          <span className="status-dot" />
          Datos actualizados desde Google Sheets
        </div>
      </header>
 
      <main className="container">
        <section className="intro">
          <div>
            <span className="eyebrow">VISUALIZACIÓN TERRITORIAL</span>
            <h2>¿Dónde están nuestros adoptantes?</h2>
            <p>
              Explorá la distribución territorial de las instituciones
              vinculadas a los proyectos PEIDI.
            </p>
          </div>
 
          <button className="reset-button" onClick={resetFilters}>
            Restablecer filtros
          </button>
        </section>
 
        {loading && (
          <div className="state-card">
            <div className="loader" />
            <span>Cargando información...</span>
          </div>
        )}
 
        {error && (
          <div className="error-card">
            <strong>No se pudieron cargar los datos.</strong>
            <p>{error}</p>
            <p>
              Verificá que el Google Sheet esté compartido como "Cualquier
              persona con el enlace" y que
              <code> VITE_SHEET_ID </code>
              tenga el ID correcto.
            </p>
          </div>
        )}
 
        {!loading && !error && (
          <>
            <section className="stats-grid">
              <StatCard
                label="Proyectos"
                value={uniqueProjects}
                detail="según filtros actuales"
              />
              <StatCard
                label="Adoptantes"
                value={filteredAdopters.length}
                detail="instituciones registradas"
              />
              <StatCard
                label="Localidades"
                value={uniqueLocalities}
                detail="con presencia territorial"
              />
              <StatCard
                label="Tipos de institución"
                value={uniqueTypes}
                detail="categorías de adoptantes"
              />
            </section>
 
            <section className="workspace">
              <div className="map-card">
                <div className="card-header">
                  <div>
                    <h3>Mapa de adoptantes</h3>
                    <p>
                      Hacé clic sobre un punto para consultar el proyecto y la
                      institución.
                    </p>
                  </div>
                  <span className="result-badge">
                    {filteredAdopters.length} ubicaciones
                  </span>
                </div>
 
                <div className="map-container">
                  <MapContainer
                    center={DEFAULT_CENTER}
                    zoom={7}
                    scrollWheelZoom
                    className="leaflet-map"
                  >
                    <TileLayer
                      attribution='Mapa base: <a href="https://www.ign.gob.ar" target="_blank" rel="noreferrer">Instituto Geográfico Nacional (Argenmap)</a>'
                      url={ARGENMAP_URL}
                      maxZoom={18}
                    />
 
                    <FitMap points={filteredAdopters} />
 
                    <MarkerClusterGroup
                      key={clusterKey}
                      chunkedLoading
                      showCoverageOnHover={false}
                      spiderfyOnMaxZoom
                    >
                      {filteredAdopters.map((adopter) => {
                        const project =
                          projectMap.get(makeKey(adopter.periodo, adopter.codigo)) ||
                          {};
 
                        return (
                          <Marker
                            key={adopter.id}
                            position={adopter.position}
                            icon={makeIcon(adopter.tipo)}
                          >
                            <Popup>
                              <div className="popup">
                                <span className="popup-code">
                                  {adopter.codigo} · {adopter.periodo}
                                </span>
 
                                <h4>{adopter.adoptante}</h4>
 
                                <div className="popup-row">
                                  <strong>Proyecto</strong>
                                  <span>{project.titulo || "Sin título"}</span>
                                </div>
 
                                <div className="popup-row">
                                  <strong>Tipo</strong>
                                  <span>{adopter.tipo || "Sin especificar"}</span>
                                </div>
 
                                <div className="popup-row">
                                  <strong>Ubicación</strong>
                                  <span>
                                    {adopter.localidad}
                                    {adopter.provincia
                                      ? `, ${adopter.provincia}`
                                      : ""}
                                    {adopter.pais ? `, ${adopter.pais}` : ""}
                                  </span>
                                </div>
 
                                {project.director && (
                                  <div className="popup-row">
                                    <strong>Director/a</strong>
                                    <span>{project.director}</span>
                                  </div>
                                )}
                              </div>
                            </Popup>
                          </Marker>
                        );
                      })}
                    </MarkerClusterGroup>
                  </MapContainer>
                </div>
 
                <div className="map-legend">
                  <span className="legend-title">Tipos</span>
                  {typeData.slice(0, 7).map((item) => (
                    <span className="legend-item" key={item.tipo}>
                      <i
                        style={{
                          background: TYPE_COLORS[item.tipo] || "#475569",
                        }}
                      />
                      {item.tipo}
                    </span>
                  ))}
                </div>
              </div>
 
              <aside className="filters-card">
                <div className="card-header compact">
                  <div>
                    <h3>Filtros</h3>
                    <p>Combiná los criterios para explorar el mapa.</p>
                  </div>
                </div>
 
                <label>
                  <span>Período</span>
                  <select
                    value={period}
                    onChange={(e) => {
                      setPeriod(e.target.value);
                      setProjectKey("TODOS"); // evita desajustes al cambiar de período
                    }}
                  >
                    {periods.map((value) => (
                      <option key={value} value={value}>
                        {value === "TODOS" ? "Todos los períodos" : value}
                      </option>
                    ))}
                  </select>
                </label>
 
                <label>
                  <span>Proyecto</span>
                  <select
                    value={projectKey}
                    onChange={(e) => setProjectKey(e.target.value)}
                  >
                    <option value="TODOS">Todos los proyectos</option>
                    {projectOptions.map((project) => {
                      const key = makeKey(project.periodo, project.codigo);
                      return (
                        <option key={key} value={key}>
                          {period === "TODOS" ? `[${project.periodo}] ` : ""}
                          {project.codigo} · {project.titulo}
                        </option>
                      );
                    })}
                  </select>
                </label>
 
                <label>
                  <span>Tipo de institución</span>
                  <select value={type} onChange={(e) => setType(e.target.value)}>
                    {typeOptions.map((value) => (
                      <option key={value} value={value}>
                        {value === "TODOS" ? "Todos los tipos" : value}
                      </option>
                    ))}
                  </select>
                </label>
 
                <label>
                  <span>Localidad</span>
                  <select
                    value={locality}
                    onChange={(e) => setLocality(e.target.value)}
                  >
                    {localityOptions.map((value) => (
                      <option key={value} value={value}>
                        {value === "TODAS" ? "Todas las localidades" : value}
                      </option>
                    ))}
                  </select>
                </label>
 
                <label>
                  <span>Buscar</span>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Institución, localidad, proyecto..."
                  />
                </label>
 
                <div className="filter-summary">
                  <strong>{filteredAdopters.length}</strong>
                  <span>resultados encontrados</span>
                </div>
              </aside>
            </section>
 
            <section className="charts-grid">
              <div className="chart-card">
                <div className="card-header">
                  <div>
                    <h3>Adoptantes por localidad</h3>
                    <p>Distribución territorial según los filtros.</p>
                  </div>
                </div>
 
                <div className="chart">
                  {localityData.length ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart
                        data={localityData}
                        layout="vertical"
                        margin={{ top: 5, right: 15, left: 20, bottom: 5 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" allowDecimals={false} />
                        <YAxis
                          dataKey="localidad"
                          type="category"
                          width={125}
                          tick={{ fontSize: 12 }}
                        />
                        <Tooltip />
                        <Bar
                          dataKey="cantidad"
                          name="Adoptantes"
                          fill="#003A8F"
                          radius={[0, 5, 5, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="empty-chart">No hay datos para mostrar.</div>
                  )}
                </div>
              </div>
 
              <div className="chart-card">
                <div className="card-header">
                  <div>
                    <h3>Tipo de institución</h3>
                    <p>Composición de los adoptantes visibles.</p>
                  </div>
                </div>
 
                <div className="chart">
                  {typeData.length ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart
                        data={typeData}
                        layout="vertical"
                        margin={{ top: 5, right: 15, left: 20, bottom: 5 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" allowDecimals={false} />
                        <YAxis
                          dataKey="tipo"
                          type="category"
                          width={155}
                          tick={{ fontSize: 11 }}
                        />
                        <Tooltip />
                        <Bar
                          dataKey="cantidad"
                          name="Adoptantes"
                          fill="#5FA8AC"
                          radius={[0, 5, 5, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="empty-chart">No hay datos para mostrar.</div>
                  )}
                </div>
              </div>
            </section>
 
            <section className="projects-card">
              <div className="card-header">
                <div>
                  <h3>Proyectos vinculados</h3>
                  <p>
                    Detalle de los proyectos que aparecen en la selección actual.
                  </p>
                </div>
              </div>
 
              <div className="project-list">
                {visibleProjects.map((project) => (
                  <article
                    className="project-item"
                    key={makeKey(project.periodo, project.codigo)}
                  >
                    <div className="project-code">{project.codigo}</div>
 
                    <div className="project-content">
                      <div className="project-meta">
                        <span>{project.periodo}</span>
                        {project.director && (
                          <span>Director/a: {project.director}</span>
                        )}
                      </div>
 
                      <h4>{project.titulo}</h4>
 
                      <div className="project-adopters">
                        {filteredAdopters
                          .filter(
                            (a) =>
                              a.periodo === project.periodo &&
                              a.codigo === project.codigo
                          )
                          .map((a) => (
                            <span key={a.id} className="adopter-chip">
                              {a.adoptante}
                            </span>
                          ))}
                      </div>
                    </div>
                  </article>
                ))}
 
                {!visibleProjects.length && (
                  <div className="empty-projects">
                    No hay proyectos que coincidan con los filtros actuales.
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </main>
 
      <footer className="footer">
        <span>Universidad Nacional de Villa María</span>
        <span>Visualización de datos PEIDI</span>
      </footer>
    </div>
  );
}
 
export default App;