import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import "leaflet/dist/leaflet.css";

/* --- ICONOS --- */
const userIcon = new L.Icon({
  iconUrl: "https://cdn-icons-png.flaticon.com/512/684/684908.png",
  iconSize: [35, 35],
});

const markerShadow = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png";

const getPlaceIcon = (type, distance) => {
  if (type === "Hotel") {
    return new L.Icon({
      iconUrl:
        "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png",
      shadowUrl: markerShadow,
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowSize: [41, 41],
    });
  }

  let color = "red";
  if (distance < 500) color = "green";
  else if (distance < 1000) color = "orange";

  return new L.Icon({
    iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${color}.png`,
    shadowUrl: markerShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
  });
};

/* --- UTILIDADES --- */
const getDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

function RecenterMap({ position }) {
  const map = useMap();
  useEffect(() => {
    if (position) map.setView(position, 15);
  }, [position]);
  return null;
}

export default function App() {
  const [userPosition, setUserPosition] = useState(null);
  const [places, setPlaces] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [radius, setRadius] = useState(1000);
  const [loading, setLoading] = useState(false);

  const [showRestaurants, setShowRestaurants] = useState(true);
  const [showFastFood, setShowFastFood] = useState(true);
  const [showHotels, setShowHotels] = useState(true);

  const [searchResults, setSearchResults] = useState([]); // lista de coincidencias por nombre
  const [lastFetch, setLastFetch] = useState(0);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserPosition([pos.coords.latitude, pos.coords.longitude]);
        },
        () => {
          setUserPosition([14.0723, -87.1921]); // fallback
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
      );
    } else {
      setUserPosition([14.0723, -87.1921]);
    }
  }, []);

  const fetchPlaces = useCallback(async () => {
    if (!userPosition) return;

    // Evitar refrescar si pasaron menos de 30 segundos
    const now = Date.now();
    if (now - lastFetch < 30000) return;

    setLoading(true);
    setLastFetch(now);

    const lat = userPosition[0];
    const lon = userPosition[1];

    const query = `
      [out:json][timeout:25];
      (
        node["amenity"="restaurant"](around:${radius},${lat},${lon});
        way["amenity"="restaurant"](around:${radius},${lat},${lon});
        relation["amenity"="restaurant"](around:${radius},${lat},${lon});

        node["amenity"="fast_food"](around:${radius},${lat},${lon});
        way["amenity"="fast_food"](around:${radius},${lat},${lon});
        relation["amenity"="fast_food"](around:${radius},${lat},${lon});

        node["shop"="fast_food"](around:${radius},${lat},${lon});
        way["shop"="fast_food"](around:${radius},${lat},${lon});
        relation["shop"="fast_food"](around:${radius},${lat},${lon});

        node["tourism"="hotel"](around:${radius},${lat},${lon});
        way["tourism"="hotel"](around:${radius},${lat},${lon});
        relation["tourism"="hotel"](around:${radius},${lat},${lon});
      );
      out center;
    `;

    try {
      const url = "https://overpass-api.de/api/interpreter";
      const response = await axios.post(url, query, {
        headers: { "Content-Type": "text/plain" },
      });

      const els = response.data.elements || [];
      const unique = new Map();

      els.forEach((el) => {
        const latEl = el.lat !== undefined ? el.lat : el.center?.lat;
        const lonEl = el.lon !== undefined ? el.lon : el.center?.lon;
        if (latEl == null || lonEl == null) return;

        const tags = el.tags || {};
        const name = tags.name || tags.brand || "Sin nombre";
        const tagType =
          tags.amenity === "restaurant"
            ? "Restaurante"
            : tags.amenity === "fast_food" || tags.shop === "fast_food"
            ? "Comedor"
            : tags.tourism === "hotel"
            ? "Hotel"
            : "Otro";

        const distance = Math.round(
          getDistance(userPosition[0], userPosition[1], latEl, lonEl)
        );

        const key = `${el.type}-${el.id}`;
        if (!unique.has(key)) {
          unique.set(key, {
            id: key,
            name,
            type: tagType,
            coords: [latEl, lonEl],
            distance,
            tags,
          });
        }
      });

      const arr = Array.from(unique.values()).sort(
        (a, b) => a.distance - b.distance
      );
      setPlaces(arr);
    } catch (err) {
      console.error("Error al obtener lugares:", err);
      alert("No se pudieron cargar los lugares. Por favor intente más tarde.");
    } finally {
      setLoading(false);
    }
  }, [userPosition, radius, lastFetch]);

  useEffect(() => {
    fetchPlaces();
  }, [userPosition, radius, fetchPlaces]);

  // 🔍 Buscador mejorado
  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery) return;

    // buscar primero en los lugares obtenidos (case-insensitive)
    const matches = places.filter((p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (matches.length > 0) {
      setSearchResults(matches);
      if (matches.length === 1) {
        setUserPosition(matches[0].coords);
        setSearchResults([]);
      }
      return;
    }

    // si no hubo matches -> usar Nominatim
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
        searchQuery
      )}`;
      const r = await axios.get(url);
      if (r.data && r.data.length > 0) {
        const { lat, lon } = r.data[0];
        setUserPosition([parseFloat(lat), parseFloat(lon)]);
      } else {
        alert("No se encontró el lugar.");
      }
    } catch {
      alert("Error en la búsqueda.");
    }
  };

  const filteredPlaces = places.filter((p) =>
    p.type === "Restaurante"
      ? showRestaurants
      : p.type === "Comedor"
      ? showFastFood
      : p.type === "Hotel"
      ? showHotels
      : false
  );

  return (
    <div style={{ height: "100vh", width: "100%" }}>
      {/* Barra superior */}
      <div
        style={{
          position: "absolute",
          top: 10,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 1000,
          background: "white",
          padding: 10,
          borderRadius: 12,
          boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <form onSubmit={handleSearch} style={{ display: "flex", gap: 8 }}>
          <input
            placeholder="Buscar ciudad o restaurante..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ padding: 6, borderRadius: 8, border: "1px solid #ccc" }}
          />
          <button
            type="submit"
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              background: "#2563eb",
              color: "#fff",
              border: "none",
            }}
          >
            Buscar
          </button>
        </form>

        {/* Modificar el select de radio */}
        <select
          value={radius}
          onChange={(e) => {
            const value = Number(e.target.value);
            if (value > 0 && value <= 5000) {
              setRadius(value);
            }
          }}
          style={{ padding: 6, borderRadius: 8 }}
        >
          <option value={500}>500 m</option>
          <option value={1000}>1 km</option>
          <option value={2000}>2 km</option>
          <option value={5000}>5 km</option>
        </select>

        <button onClick={fetchPlaces} style={{ padding: "6px 10px", borderRadius: 8 }}>
          {loading ? "Buscando..." : "Actualizar"}
        </button>
      </div>

      {/* Lista de coincidencias por nombre */}
      {searchResults.length > 1 && (
        <div
          style={{
            position: "absolute",
            top: 60,
            left: "50%",
            transform: "translateX(-50%)",
            background: "white",
            padding: 10,
            borderRadius: 8,
            boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
            zIndex: 1000,
            maxHeight: 200,
            overflowY: "auto",
          }}
        >
          <strong>Coincidencias:</strong>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {searchResults.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => {
                    setUserPosition(r.coords);
                    setSearchResults([]);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: "4px 0",
                    textAlign: "left",
                  }}
                >
                  {r.name} ({r.type})
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Mapa */}
      {userPosition ? (
        <MapContainer
          center={userPosition}
          zoom={15}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer attribution='&copy; OSM' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <RecenterMap position={userPosition} />
          <Marker position={userPosition} icon={userIcon}>
            <Popup>📍 Estás aquí</Popup>
          </Marker>

          {filteredPlaces.map((p) => (
            <Marker
              key={p.id}
              position={p.coords}
              icon={getPlaceIcon(p.type, p.distance)}
            >
              <Popup>
                <strong>{p.name}</strong>
                <br />
                Tipo: {p.type}
                <br />
                Distancia: {p.distance} m
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      ) : (
        <div style={{ textAlign: "center", marginTop: 20 }}>
          Obteniendo ubicación...
        </div>
      )}

      {/* Filtros de tipo de lugar */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", position: "absolute", top: 50, left: "50%", transform: "translateX(-50%)", zIndex: 1000 }}>
        <label>
          <input
            type="checkbox"
            checked={showRestaurants}
            onChange={e => setShowRestaurants(e.target.checked)}
          />
          Restaurantes
        </label>
        <label>
          <input
            type="checkbox" 
            checked={showFastFood}
            onChange={e => setShowFastFood(e.target.checked)}
          />
          Comedores
        </label>
        <label>
          <input
            type="checkbox"
            checked={showHotels} 
            onChange={e => setShowHotels(e.target.checked)}
          />
          Hoteles
        </label>
      </div>

      {/* Agregado el spinner de carga */}
      {loading && (
        <div style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          background: "rgba(255,255,255,0.8)",
          padding: "20px",
          borderRadius: "8px",
          zIndex: 1001
        }}>
          Cargando lugares...
        </div>
      )}
    </div>
  );
}
