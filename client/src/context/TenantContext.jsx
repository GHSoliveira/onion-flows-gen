import { createContext, useContext, useState, useEffect } from "react";
import { apiRequest } from "../services/api";

const TenantContext = createContext(null);

export const TenantProvider = ({ children }) => {
  const [tenant, setTenant] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState(null);

  useEffect(() => {
    const savedTenant = localStorage.getItem("selectedTenant");
    if (savedTenant) {
      try {
        const parsed = JSON.parse(savedTenant);
        setTenant(parsed);
        setLoading(false);
        return;
      } catch (e) {
        localStorage.removeItem("selectedTenant");
      }
    }
    fetchTenant();
  }, []);

  const fetchTenant = async () => {
    try {
      const res = await apiRequest("/tenant/current");
      if (res && res.ok) {
        const data = await res.json();
        setTenant(data);
        setUserRole(data.role);

        localStorage.setItem("selectedTenant", JSON.stringify(data));
      }
    } catch (error) {
      console.error("Erro ao buscar tenant:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchTenants = async () => {
    try {
      const res = await apiRequest("/tenants");
      if (res && res.ok) {
        const data = await res.json();
        setTenants(data);
      }
    } catch (error) {
      console.error("Erro ao buscar tenants:", error);
    }
  };

  const switchTenant = async (tenantId) => {
    if (tenantId === "super_admin") {
      localStorage.removeItem("selectedTenant");
      setTenant({ id: "super_admin", name: "Super Admin", role: "SUPER_ADMIN" });
      setLoading(false);
      return;
    }
    try {
      const res = await apiRequest("/tenants/" + tenantId + "/switch", { method: "POST" });
      if (res && res.ok) {
        const data = await res.json();
        localStorage.setItem("selectedTenant", JSON.stringify(data));
        setTenant(data);
      }
    } catch (error) {
      console.error("Erro ao trocar de tenant:", error);
    }
  };

  return (
    <TenantContext.Provider value={{
      tenant, tenants, loading, fetchTenant, fetchTenants, switchTenant,
      isSuperAdmin: userRole === "SUPER_ADMIN" || tenant?.id === "super_admin"
    }}>
      {children}
    </TenantContext.Provider>
  );
};

export const useTenant = () => {
  const context = useContext(TenantContext);
  if (!context) throw new Error("useTenant deve ser usado dentro de TenantProvider");
  return context;
};
