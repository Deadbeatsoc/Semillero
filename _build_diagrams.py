# -*- coding: utf-8 -*-
"""
Genera 5 diagramas UML del proyecto "Plataforma local de prediccion y
reporte de accidentes" y los exporta como PNGs individuales + un PDF
consolidado.
"""
import os
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch, Rectangle, Ellipse
from matplotlib.backends.backend_pdf import PdfPages

OUT_DIR = r"C:\Users\Omarl\Downloads\diagramas_evaluacion"
os.makedirs(OUT_DIR, exist_ok=True)
PDF_PATH = os.path.join(OUT_DIR, "Diagramas_Evaluacion_Software.pdf")

# ===== Paleta =====
C_PRIMARY = "#1F3A68"
C_SECONDARY = "#2C6FBB"
C_ACCENT = "#E29E1F"
C_LIGHT = "#EAF1FB"
C_BG = "#FFFFFF"
C_TEXT = "#1A1A1A"
C_OK = "#2F8E3A"
C_RED = "#B92A2A"


def base_fig(title, subtitle=""):
    fig, ax = plt.subplots(figsize=(16, 11))
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 70)
    ax.set_aspect('equal')
    ax.axis('off')

    # Banda superior
    ax.add_patch(Rectangle((0, 65), 100, 5, facecolor=C_PRIMARY, edgecolor='none'))
    ax.text(50, 67.5, title, ha='center', va='center', color='white',
            fontsize=18, fontweight='bold')
    if subtitle:
        ax.text(50, 63, subtitle, ha='center', va='center', color=C_PRIMARY,
                fontsize=11, style='italic')

    # Pie
    ax.text(99, 0.6, "Plataforma local de prediccion y reporte de accidentes  |  Semillero",
            ha='right', va='bottom', fontsize=8, color="#666666")
    return fig, ax


def box(ax, x, y, w, h, title, lines=None, color=C_LIGHT, border=C_PRIMARY,
        title_color=C_PRIMARY, lw=1.5):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.02",
                                facecolor=color, edgecolor=border, lw=lw))
    ax.text(x + w/2, y + h - 1.2, title, ha='center', va='top',
            fontsize=10, fontweight='bold', color=title_color)
    if lines:
        ax.plot([x + 0.4, x + w - 0.4], [y + h - 2.2, y + h - 2.2],
                color=border, lw=0.8)
        for i, line in enumerate(lines):
            ax.text(x + 0.5, y + h - 3 - i*1.1, line, ha='left', va='top',
                    fontsize=8, color=C_TEXT)


def class_box(ax, x, y, w, h, name, attrs, methods):
    ax.add_patch(Rectangle((x, y), w, h, facecolor=C_LIGHT,
                           edgecolor=C_PRIMARY, lw=1.5))
    # Cabecera
    ax.add_patch(Rectangle((x, y + h - 1.6), w, 1.6, facecolor=C_PRIMARY, edgecolor=C_PRIMARY))
    ax.text(x + w/2, y + h - 0.8, name, ha='center', va='center',
            color='white', fontsize=10, fontweight='bold')

    # Linea separadora atributos / metodos
    n_attrs = len(attrs)
    sep_y = y + h - 1.6 - (n_attrs * 0.95) - 0.4
    for i, a in enumerate(attrs):
        ax.text(x + 0.3, y + h - 2.4 - i*0.95, a, ha='left', va='center',
                fontsize=7, color=C_TEXT)
    ax.plot([x, x + w], [sep_y, sep_y], color=C_PRIMARY, lw=0.8)
    for i, m in enumerate(methods):
        ax.text(x + 0.3, sep_y - 0.7 - i*0.95, m, ha='left', va='center',
                fontsize=7, color=C_TEXT)


def arrow(ax, x1, y1, x2, y2, color=C_PRIMARY, label=None, style='-|>', lw=1.2,
          label_offset=(0, 0.6), dashed=False):
    # 'style' aqui es arrowstyle de matplotlib. Si pasan '--' o '-' lo
    # interpretamos como linestyle dashed/solid en una flecha simple.
    linestyle = 'solid'
    arrowstyle = style
    if style in ('--', ':'):
        linestyle = 'dashed' if style == '--' else 'dotted'
        arrowstyle = '-'
    elif style == '-':
        arrowstyle = '-'
    if dashed:
        linestyle = 'dashed'
    arr = FancyArrowPatch((x1, y1), (x2, y2),
                          arrowstyle=arrowstyle, mutation_scale=14,
                          color=color, lw=lw, linestyle=linestyle)
    ax.add_patch(arr)
    if label:
        ax.text((x1+x2)/2 + label_offset[0], (y1+y2)/2 + label_offset[1],
                label, ha='center', va='center', fontsize=7.5,
                color=color, fontweight='bold',
                bbox=dict(boxstyle='round,pad=0.18', facecolor='white',
                          edgecolor='none', alpha=0.9))


# =====================================================================
# 1. DIAGRAMA DE CLASES
# =====================================================================
def diagram_classes(pdf):
    fig, ax = base_fig("Diagrama de Clases",
                       "Entidades de dominio + servicios principales (backend)")

    class_box(ax, 3, 38, 18, 22, "User",
              ["- id: int", "- username: str", "- passwordHash: str",
               "- role: enum {user, admin}", "- isActive: bool",
               "- lastLoginAt: datetime"],
              ["+ register()", "+ login()", "+ logout()"])

    class_box(ax, 26, 38, 19, 22, "AuthSession",
              ["- id: int", "- userId: FK(User)",
               "- tokenHash: sha256 hex",
               "- expiresAt: datetime", "- lastUsedAt: datetime",
               "- createdAt: datetime"],
              ["+ resolveAuthenticatedUser()", "+ delete()"])

    class_box(ax, 50, 38, 20, 22, "RegistrationCode",
              ["- id: int", "- codeValue: str(6)",
               "- isActive: bool", "- createdAt: datetime",
               "- replacedAt: datetime"],
              ["+ regenerate()", "+ getActive()"])

    class_box(ax, 75, 38, 22, 22, "ActivityLog",
              ["- id: int", "- userId: FK(User)",
               "- eventType: str",
               "- eventData: json",
               "- createdAt: datetime"],
              ["+ createActivityLog()"])

    class_box(ax, 3, 8, 18, 24, "City",
              ["- id: int", "- cityKey: str",
               "- label: str", "- centerLat: dec",
               "- centerLng: dec",
               "- bbox: (W,S,E,N)",
               "- zoomLevel: int"],
              ["+ getCityProfile()"])

    class_box(ax, 26, 8, 19, 24, "AccidentEvent",
              ["- id: bigint", "- cityId: FK(City)",
               "- roadSegmentId: FK", "- occurredAt: datetime",
               "- severity: enum", "- weather: enum",
               "- period: enum",
               "- latitude / longitude"],
              ["+ seedFromOSM()"])

    class_box(ax, 50, 8, 20, 24, "PredictionRun",
              ["- id: bigint", "- cityId: FK(City)",
               "- filterPayload: json", "- rangeMode: enum",
               "- rangeStart / rangeEnd",
               "- modelVersion: str",
               "- createdAt: datetime"],
              ["+ fetchLocalPredictions()"])

    class_box(ax, 75, 8, 22, 24, "CitizenReport",
              ["- id: uuid", "- description: text",
               "- severity: enum", "- latitude/longitude",
               "- evidenceUrl: str",
               "- status: enum (nuevo/aprobado)",
               "- reviewedByAdminId: FK",
               "- publishedForDate: date"],
              ["+ create()", "+ approve()", "+ listApprovedToday()"])

    # Relaciones
    arrow(ax, 21, 49, 26, 49, label="1..*", style='-')
    arrow(ax, 45, 49, 50, 49, label="usa", style='-')
    arrow(ax, 21, 44, 75, 44, label="genera 1..*", style='-')
    arrow(ax, 12, 38, 12, 32, label="evento *", style='-')
    arrow(ax, 21, 18, 26, 18, label="ocurre en 1", style='-')
    arrow(ax, 21, 14, 50, 14, label="alimenta", style='--')
    arrow(ax, 70, 18, 75, 18, label="ciudadano reporta", style='-')

    plt.savefig(os.path.join(OUT_DIR, "1_diagrama_clases.png"),
                dpi=180, bbox_inches='tight', facecolor='white')
    pdf.savefig(fig, bbox_inches='tight')
    plt.close(fig)


# =====================================================================
# 2. DIAGRAMA DE DESPLIEGUE
# =====================================================================
def diagram_deployment(pdf):
    fig, ax = base_fig("Diagrama de Despliegue",
                       "Nodos de ejecucion y servicios externos")

    # Nodo cliente
    box(ax, 4, 38, 24, 20, "<<device>> Estacion del usuario",
        ["Navegador Chrome / Firefox",
         "SPA React + Vite (puerto 5173 dev)",
         "Leaflet.js + OpenStreetMap tiles",
         "Socket.IO client",
         "LocalStorage: auth_token, auth_user"],
        color="#FFF7E6", border=C_ACCENT, title_color=C_ACCENT)

    # Nodo servidor
    box(ax, 38, 30, 30, 28, "<<application server>> Backend Node.js 18+",
        ["Express.js (HTTP API REST)",
         "Socket.IO Server (WebSocket)",
         "Routers: auth, admin, reports, activity",
         "Servicios: localPredictionEngine",
         "          authSecurity (scrypt)",
         "          geocodingClient",
         "          weatherForecastService",
         "          reportEvidenceService",
         "Cache dual: cityModelCache + responseCache",
         "Puerto: 4000 (configurable PORT)"],
        color=C_LIGHT, border=C_PRIMARY)

    # DB
    box(ax, 73, 38, 22, 20, "<<database>> MySQL 8",
        ["Pool mysql2 (10 conexiones)",
         "Schema: traffic_app",
         "Tablas:",
         "  users, auth_sessions, activity_logs",
         "  cities, road_segments,",
         "  accident_events, prediction_runs,",
         "  citizen_reports, registration_codes",
         "Migraciones idempotentes"],
        color="#E6F4EA", border=C_OK, title_color=C_OK)

    # Almacen de evidencias
    box(ax, 38, 14, 30, 12, "<<filesystem>> uploads/reports",
        ["Imagenes de evidencia ciudadana",
         "Servidas via /uploads (estatico)",
         "Cleanup automatico si falla el insert"],
        color="#FFFBE6", border="#A18524", title_color="#7A5C00")

    # Servicios externos
    box(ax, 4, 6, 18, 18, "<<external>> Nominatim OSM",
        ["Geocodificacion directa",
         "Geocodificacion inversa",
         "User-Agent configurable",
         "Base URL configurable"],
        color="#F5E6FF", border="#6B2C9D", title_color="#6B2C9D")

    box(ax, 26, 6, 18, 18, "<<external>> Overpass API",
        ["Descarga vias OSM por bbox",
         "Usado por seed:villavicencio",
         "Genera road_segments + path_json"],
        color="#F5E6FF", border="#6B2C9D", title_color="#6B2C9D")

    box(ax, 78, 6, 18, 18, "<<external>> WeatherAPI",
        ["Pronostico de lluvia/hora",
         "Resumen diario (3 dias por defecto)",
         "API key WEATHERAPI_KEY"],
        color="#F5E6FF", border="#6B2C9D", title_color="#6B2C9D")

    # Conexiones
    arrow(ax, 28, 48, 38, 48, label="HTTPS + WS (4000)", style='->', lw=2)
    arrow(ax, 68, 48, 73, 48, label="mysql2 pool", style='->', lw=2)
    arrow(ax, 53, 30, 53, 26, label="fs writes", style='->', lw=1.5)
    arrow(ax, 13, 30, 13, 24, label="HTTPS", style='->', lw=1.2)
    arrow(ax, 35, 30, 35, 24, label="HTTPS", style='->', lw=1.2)
    arrow(ax, 87, 30, 87, 24, label="HTTPS", style='->', lw=1.2)

    plt.savefig(os.path.join(OUT_DIR, "2_diagrama_despliegue.png"),
                dpi=180, bbox_inches='tight', facecolor='white')
    pdf.savefig(fig, bbox_inches='tight')
    plt.close(fig)


# =====================================================================
# 3. DIAGRAMA DE CASOS DE USO
# =====================================================================
def diagram_use_cases(pdf):
    fig, ax = base_fig("Diagrama de Casos de Uso",
                       "Actores: Usuario, Administrador, Servicios externos")

    # Caja sistema
    ax.add_patch(FancyBboxPatch((20, 6), 60, 55,
                                boxstyle="round,pad=0.02",
                                facecolor='white', edgecolor=C_PRIMARY, lw=2))
    ax.text(50, 58, "Sistema: Plataforma de prediccion",
            ha='center', va='center', fontsize=11, fontweight='bold',
            color=C_PRIMARY)

    # Actores
    def stick_figure(cx, cy, name):
        ax.add_patch(Ellipse((cx, cy + 3.2), 1.2, 1.4, facecolor='white',
                             edgecolor=C_PRIMARY, lw=1.4))
        ax.plot([cx, cx], [cy + 2.5, cy], color=C_PRIMARY, lw=1.4)
        ax.plot([cx - 1, cx + 1], [cy + 1.8, cy + 1.8], color=C_PRIMARY, lw=1.4)
        ax.plot([cx, cx - 0.9], [cy, cy - 1.4], color=C_PRIMARY, lw=1.4)
        ax.plot([cx, cx + 0.9], [cy, cy - 1.4], color=C_PRIMARY, lw=1.4)
        ax.text(cx, cy - 2.2, name, ha='center', va='top',
                fontsize=9, fontweight='bold', color=C_PRIMARY)

    stick_figure(8, 40, "Usuario")
    stick_figure(8, 18, "Administrador")
    stick_figure(92, 40, "Nominatim /\nWeatherAPI")

    # Casos de uso (elipses)
    def usecase(cx, cy, w, h, label, color=C_LIGHT):
        ax.add_patch(Ellipse((cx, cy), w, h, facecolor=color,
                             edgecolor=C_PRIMARY, lw=1.2))
        ax.text(cx, cy, label, ha='center', va='center',
                fontsize=8.5, color=C_TEXT, wrap=True)

    # Casos de usuario
    usecase(35, 52, 18, 4.5, "Registrarse con codigo\nde verificacion")
    usecase(35, 46, 18, 4.5, "Iniciar / cerrar sesion")
    usecase(35, 39, 18, 4.5, "Consultar prediccion\npor filtros")
    usecase(35, 32, 18, 4.5, "Consultar prediccion\npor direccion/coordenadas")
    usecase(35, 25, 18, 4.5, "Consultar pronostico\nde clima")
    usecase(35, 18, 18, 4.5, "Enviar reporte ciudadano\ncon evidencia")
    usecase(35, 11, 18, 4.5, "Ver reportes aprobados\ndel dia")

    # Casos admin
    usecase(64, 52, 18, 4.5, "Ver dashboard\nde metricas",
            color="#FFF1D6")
    usecase(64, 45, 18, 4.5, "Gestionar codigo\nde verificacion",
            color="#FFF1D6")
    usecase(64, 38, 18, 4.5, "Aprobar / rechazar\nreportes pendientes",
            color="#FFF1D6")
    usecase(64, 31, 18, 4.5, "Listar solicitudes\npendientes",
            color="#FFF1D6")

    # Casos compartidos
    usecase(64, 22, 18, 4.5, "Autocompletar\ndirecciones",
            color="#EAF6E6")
    usecase(64, 14, 18, 4.5, "Geocodificacion\ninversa",
            color="#EAF6E6")

    # Relaciones usuario
    for y in [52, 46, 39, 32, 25, 18, 11]:
        arrow(ax, 10, 40, 26, y, style='-', lw=0.8, color="#666666")

    # Relaciones admin
    for y in [52, 45, 38, 31]:
        arrow(ax, 10, 18, 55, y, style='-', lw=0.8, color="#666666")

    # Admin tambien hereda usuario
    arrow(ax, 10, 21, 10, 36, style='->', label="es-un",
          lw=1, color=C_ACCENT)

    # Servicios externos
    arrow(ax, 73, 22, 90, 38, style='-', lw=0.8, color="#666666")
    arrow(ax, 73, 14, 90, 40, style='-', lw=0.8, color="#666666")
    arrow(ax, 44, 25, 90, 41, style='--', lw=0.8, color="#666666",
          label="<<include>>")

    plt.savefig(os.path.join(OUT_DIR, "3_diagrama_casos_uso.png"),
                dpi=180, bbox_inches='tight', facecolor='white')
    pdf.savefig(fig, bbox_inches='tight')
    plt.close(fig)


# =====================================================================
# 4. DIAGRAMA DE SECUENCIA
# =====================================================================
def diagram_sequence(pdf):
    fig, ax = base_fig("Diagrama de Secuencia",
                       "Flujo: Solicitar prediccion por direccion (con cache caliente)")

    # Lifelines
    actores = [
        ("Usuario\n(React SPA)", 8, "#FFF7E6", C_ACCENT),
        ("Express\nrouter /api", 25, C_LIGHT, C_PRIMARY),
        ("requireAuth\n(middleware)", 42, C_LIGHT, C_PRIMARY),
        ("localPrediction\nEngine", 60, C_LIGHT, C_PRIMARY),
        ("cityModelCache\n+ responseCache", 80, "#FFFBE6", "#A18524"),
        ("MySQL\n+ Nominatim", 94, "#E6F4EA", C_OK),
    ]
    for name, x, fc, bc in actores:
        ax.add_patch(FancyBboxPatch((x - 5, 56), 10, 4,
                                    boxstyle="round,pad=0.02",
                                    facecolor=fc, edgecolor=bc, lw=1.4))
        ax.text(x, 58, name, ha='center', va='center',
                fontsize=8.5, fontweight='bold', color=C_TEXT)
        ax.plot([x, x], [56, 6], color=bc, lw=0.7, linestyle='--')

    # Mensajes
    def msg(y, x1, x2, text, style='->', color=C_PRIMARY, dash=False):
        s = 'dashed' if dash else 'solid'
        arr = FancyArrowPatch((x1, y), (x2, y), arrowstyle=style,
                              mutation_scale=12, color=color, lw=1.3,
                              linestyle=s)
        ax.add_patch(arr)
        mid = (x1 + x2) / 2
        ax.text(mid, y + 0.7, text, ha='center', va='bottom',
                fontsize=7.5, color=color,
                bbox=dict(boxstyle='round,pad=0.18', facecolor='white',
                          edgecolor='none', alpha=0.92))

    # Activation boxes
    def activation(x, y1, y2):
        ax.add_patch(Rectangle((x - 0.6, y2), 1.2, y1 - y2,
                               facecolor=C_SECONDARY, edgecolor=C_PRIMARY,
                               lw=0.6, alpha=0.85))

    # Pasos
    msg(52, 8, 25, "GET /api/predictions?city=villavicencio&address=...&date=...&hour=18")
    activation(25, 52, 47)
    msg(50, 25, 42, "requireAuth(req)")
    activation(42, 50, 46)
    msg(48, 42, 94, "validar token Bearer (SHA-256 vs auth_sessions)")
    activation(94, 48, 46)
    msg(46, 94, 42, "OK user.id, user.role", style='->', dash=True, color="#555555")
    msg(44, 42, 25, "next()", style='->', dash=True, color="#555555")
    msg(42, 25, 60, "fetchLocalPredictions(filters)")
    activation(60, 42, 18)
    msg(40, 60, 80, "responseCache.get(cacheKey) -> miss")
    msg(38, 60, 80, "cityModelCache.get('villavicencio') -> hit")
    msg(36, 60, 60, "buildPredictions(cityModel, filters)", style='->')
    msg(34, 60, 60, "buildAddressScopedPredictions(<=2.4 km)", style='->')
    msg(32, 60, 94, "(si address sin lat/lon) Nominatim geocode")
    activation(94, 32, 30)
    msg(30, 94, 60, "lat/lon resuelto", style='->', dash=True, color="#555555")
    msg(28, 60, 80, "storeResponseCache(cacheKey, payload, TTL=5min)")
    msg(26, 60, 25, "data[], meta", style='->', dash=True, color="#555555")
    msg(24, 25, 94, "logUserActivity('prediction_query')")
    msg(22, 94, 25, "ack", style='->', dash=True, color="#555555")
    msg(20, 25, 8, "HTTP 200 { data, meta }", style='->', dash=True, color=C_OK)
    msg(18, 8, 8, "Leaflet renderiza circulos por riskScore", style='->', color=C_ACCENT)

    # Nota
    ax.add_patch(FancyBboxPatch((52, 9), 38, 4.5,
                                boxstyle="round,pad=0.02",
                                facecolor="#FFF9E0", edgecolor=C_ACCENT, lw=1.0))
    ax.text(71, 11.2,
            "Nota: si responseCache hit, se salta buildPredictions\n"
            "y se devuelve el payload cacheado (5 min TTL).",
            ha='center', va='center', fontsize=8, color=C_TEXT, style='italic')

    plt.savefig(os.path.join(OUT_DIR, "4_diagrama_secuencia.png"),
                dpi=180, bbox_inches='tight', facecolor='white')
    pdf.savefig(fig, bbox_inches='tight')
    plt.close(fig)


# =====================================================================
# 5. DIAGRAMA DE DATOS (Entidad-Relacion)
# =====================================================================
def diagram_data(pdf):
    fig, ax = base_fig("Diagrama de Datos (Entidad - Relacion)",
                       "Esquema MySQL (backend/db/migrations)")

    def table(x, y, w, name, cols):
        # Cabecera
        h = 2 + len(cols) * 0.95
        ax.add_patch(Rectangle((x, y - h), w, h,
                               facecolor=C_LIGHT, edgecolor=C_PRIMARY, lw=1.4))
        ax.add_patch(Rectangle((x, y - 1.6), w, 1.6,
                               facecolor=C_PRIMARY, edgecolor=C_PRIMARY))
        ax.text(x + w/2, y - 0.8, name, ha='center', va='center',
                color='white', fontsize=9.5, fontweight='bold')
        for i, (col, kind, key) in enumerate(cols):
            yy = y - 2.3 - i * 0.95
            tag = ""
            if "PK" in key:
                tag = "PK "
            elif "FK" in key:
                tag = "FK "
            ax.text(x + 0.3, yy, f"{tag}{col}", ha='left', va='center',
                    fontsize=7, color=C_TEXT, fontweight='bold' if tag else 'normal')
            ax.text(x + w - 0.3, yy, kind, ha='right', va='center',
                    fontsize=6.5, color="#555555", style='italic')

    # users
    table(3, 60, 19, "users",
          [("id", "BIGINT", "PK"), ("username", "VARCHAR(40)", ""),
           ("password_hash", "VARCHAR(160)", ""),
           ("role", "ENUM(user,admin)", ""),
           ("is_active", "TINYINT", ""),
           ("last_login_at", "DATETIME", "")])

    # auth_sessions
    table(25, 60, 19, "auth_sessions",
          [("id", "BIGINT", "PK"), ("user_id", "BIGINT", "FK->users"),
           ("token_hash", "CHAR(64)", ""),
           ("expires_at", "DATETIME", ""),
           ("last_used_at", "DATETIME", "")])

    # registration_codes
    table(47, 60, 20, "registration_codes",
          [("id", "BIGINT", "PK"), ("code_value", "VARCHAR(12)", ""),
           ("is_active", "TINYINT", ""),
           ("replaced_at", "DATETIME", ""),
           ("created_at", "DATETIME", "")])

    # activity_logs
    table(70, 60, 22, "activity_logs",
          [("id", "BIGINT", "PK"), ("user_id", "BIGINT", "FK->users"),
           ("event_type", "VARCHAR(40)", ""),
           ("event_data", "JSON", ""),
           ("created_at", "TIMESTAMP", "")])

    # cities
    table(3, 32, 19, "cities",
          [("id", "INT", "PK"), ("city_key", "VARCHAR(60)", ""),
           ("label", "VARCHAR(120)", ""),
           ("center_latitude", "DECIMAL", ""),
           ("center_longitude", "DECIMAL", ""),
           ("zoom_level", "TINYINT", ""),
           ("bbox_west/east/...", "DECIMAL", "")])

    # road_segments
    table(25, 32, 19, "road_segments",
          [("id", "BIGINT", "PK"), ("city_id", "INT", "FK->cities"),
           ("segment_code", "VARCHAR(120)", ""),
           ("name", "VARCHAR(180)", ""),
           ("centroid_latitude", "DECIMAL", ""),
           ("centroid_longitude", "DECIMAL", ""),
           ("path_json", "JSON", "")])

    # accident_events
    table(47, 32, 20, "accident_events",
          [("id", "BIGINT", "PK"), ("city_id", "INT", "FK->cities"),
           ("road_segment_id", "BIGINT", "FK"),
           ("occurred_at", "DATETIME", ""),
           ("severity", "ENUM", ""),
           ("weather", "ENUM", ""),
           ("period", "ENUM", ""),
           ("latitude/longitude", "DECIMAL", "")])

    # prediction_runs / points
    table(70, 32, 22, "prediction_runs",
          [("id", "BIGINT", "PK"), ("city_id", "INT", "FK->cities"),
           ("filter_payload", "JSON", ""),
           ("range_mode", "ENUM", ""),
           ("range_start/end", "DATE", ""),
           ("model_version", "VARCHAR(80)", "")])

    table(3, 6, 28, "prediction_points",
          [("id", "BIGINT", "PK"),
           ("run_id", "BIGINT", "FK->prediction_runs"),
           ("road_segment_id", "BIGINT", "FK"),
           ("risk_score", "DECIMAL", ""),
           ("risk_level", "ENUM(BAJO..MUY_ALTO)", ""),
           ("pred_leve/medio/grave_prob", "DECIMAL", ""),
           ("range_occurrences", "SMALLINT", "")])

    table(35, 6, 28, "citizen_reports",
          [("id", "CHAR(36) UUID", "PK"),
           ("description", "TEXT", ""),
           ("severity", "ENUM", ""),
           ("latitude/longitude", "DECIMAL", ""),
           ("evidence_url", "VARCHAR(255)", ""),
           ("status", "ENUM(nuevo,aprobado)", ""),
           ("reviewed_by_admin_id", "BIGINT", "FK->users"),
           ("published_for_date", "DATE", "")])

    # Relaciones
    def rel(x1, y1, x2, y2, label):
        arr = FancyArrowPatch((x1, y1), (x2, y2), arrowstyle='-',
                              mutation_scale=12, color=C_SECONDARY, lw=1.2)
        ax.add_patch(arr)
        ax.text((x1+x2)/2, (y1+y2)/2 + 0.5, label, ha='center', va='center',
                fontsize=7, color=C_SECONDARY, fontweight='bold',
                bbox=dict(boxstyle='round,pad=0.15', facecolor='white',
                          edgecolor='none', alpha=0.9))

    rel(22, 55, 25, 55, "1..N")
    rel(22, 55, 70, 55, "1..N")
    rel(22, 22, 25, 22, "1..N")
    rel(22, 22, 47, 22, "1..N")
    rel(22, 22, 70, 22, "1..N")
    rel(44, 22, 47, 22, "1..N")
    rel(70, 18, 31, 12, "1..N")
    rel(22, 50, 49, 13, "admin revisa")

    plt.savefig(os.path.join(OUT_DIR, "5_diagrama_datos.png"),
                dpi=180, bbox_inches='tight', facecolor='white')
    pdf.savefig(fig, bbox_inches='tight')
    plt.close(fig)


# Ejecutar todo
with PdfPages(PDF_PATH) as pdf:
    diagram_classes(pdf)
    diagram_deployment(pdf)
    diagram_use_cases(pdf)
    diagram_sequence(pdf)
    diagram_data(pdf)

    info = pdf.infodict()
    info['Title'] = 'Diagramas de Evaluacion de Software'
    info['Author'] = 'Semillero - Plataforma de prediccion'
    info['Subject'] = 'Criterio 2 (Diseno y arquitectura) - Diagramas obligatorios'

print(f"PDF  -> {PDF_PATH}")
print(f"PNGs -> {OUT_DIR}")
