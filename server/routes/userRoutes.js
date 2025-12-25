import express from "express";
import {
  registerUser,
  loginUser,
  userCredits,
  paymentRazorpay,
  verifyRazorpay,
  generateAndSendOTP,
  verifyOTPAndResetPassword,
} from "../controllers/userControllers.js";
import userAuth from "../middlewares/auth.js";

const userRouter = express.Router();

// Register and Login routes (no token required)
userRouter.post("/register", registerUser);
userRouter.post("/login", loginUser);

// Protected routes (require token)
userRouter.get("/credits", userAuth, userCredits);
userRouter.post("/pay-razor", userAuth, paymentRazorpay);
userRouter.post("/verify-razor", verifyRazorpay);

//resetpassword routes
userRouter.post("/forgot-password", generateAndSendOTP);
userRouter.post("/reset-password", verifyOTPAndResetPassword);

export default userRouter;
