import { createContext, useState, useEffect } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

export const AppContext = createContext();

const AppContextProvider = (props) => {
  const [user, setUser] = useState(null);
  const [showLogin, setShowLogin] = useState(false);
  const [token, setToken] = useState(localStorage.getItem("token"));
  const [credit, setCredit] = useState(false);
  const backendUrl = import.meta.env.VITE_BACKEND_URL;
  const navigate = useNavigate();

  const loadCreditsData = async () => {
    try {
      const { data } = await axios.get(`${backendUrl}/api/user/credits`, {
        headers: { token },
      });
      if (data.success) {
        setCredit(data.credits);
        setUser(data.user);
      }
    } catch (error) {
      console.log(error);
    }
  };

  const generateImage = async (prompt) => {
    try {
      if (!token) {
        console.error("❌ No authentication token");
        return null;
      }

      if (!prompt || prompt.trim() === "") {
        console.error("❌ Empty prompt provided");
        return null;
      }

      console.log("🔄 Generating image with prompt:", prompt);
      const { data } = await axios.post(
        `${backendUrl}/api/image/generate-image`,
        { prompt },
        { headers: { token } }
      );
      
      if (data.success && data.resultImage) {
        console.log("✅ Image generated successfully");
        loadCreditsData();
        return data.resultImage;
      } else {
        console.error("❌ Failed to generate image:", data.message || "Unknown error");
        return null;
      }
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message || "Unknown error";
      console.error("❌ Error generating image:", errorMessage);
      console.error("Full error:", error.response?.data || error);
      return null;
    }
  };

  const logout = () => {
    localStorage.removeItem("token");
    setToken("");
    setUser(null);
  };

  useEffect(() => {
    if (token) {
      loadCreditsData();
    }
  }, [token]);

  const value = {
    user,
    setUser,
    showLogin,
    setShowLogin,
    backendUrl,
    token,
    setToken,
    credit,
    setCredit,
    loadCreditsData,
    logout,
    generateImage,
  };

  return (
    <AppContext.Provider value={value}>{props.children}</AppContext.Provider>
  );
};

export default AppContextProvider;
