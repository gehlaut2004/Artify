import userModel from "../models/userModel.js";
import axios from "axios";

const HF_TOKEN = process.env.HF_TOKEN || process.env.HUGGING_FACE_TOKEN;
const REPLICATE_ENDPOINT =
  "https://router.huggingface.co/replicate/v1/models/stability-ai/stable-diffusion-3.5-large/predictions";

export const generateImage = async (req, res) => {
  try {
    const { userId, prompt } = req.body;

    // Basic validation
    if (!userId || !prompt) {
      return res
        .status(400)
        .json({ success: false, message: "Missing userId or prompt." });
    }

    console.log("🔍 Prompt:", prompt);
    console.log("🔍 userId:", userId);

    const user = await userModel.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    if (user.creditBalance <= 0) {
      return res.status(403).json({
        success: false,
        message: "No Credit Balance",
        creditBalance: user.creditBalance,
      });
    }

    // 🧠 Call Replicate API via Hugging Face Router
    console.log("🛠 Calling Replicate API via Hugging Face Router...");
    console.log("🔗 Endpoint:", REPLICATE_ENDPOINT);
    console.log("🔑 Token present:", !!HF_TOKEN);

    // Validate environment variables
    if (!HF_TOKEN) {
      console.error("❌ Missing Hugging Face token");
      return res.status(500).json({
        success: false,
        message:
          "Hugging Face API token not configured. Please check HF_TOKEN environment variable.",
      });
    }

    console.log("📡 Full API URL:", REPLICATE_ENDPOINT);
    console.log("📝 Prompt:", prompt);

    // Replicate API format: { input: { prompt: "..." } }
    const requestBody = {
      input: {
        prompt: prompt,
      },
    };

    console.log("📤 Request body:", JSON.stringify(requestBody));

    // Make API call - Replicate API returns blob (binary image data)
    const hfResponse = await axios.post(REPLICATE_ENDPOINT, requestBody, {
      headers: {
        Authorization: `Bearer ${HF_TOKEN}`,
        "Content-Type": "application/json",
      },
      responseType: "arraybuffer", // Expect binary blob response
      validateStatus: function (status) {
        return status >= 200 && status < 300; // Accept 2xx status codes
      },
      timeout: 120000, // 2 minutes timeout for image generation
    });

    // Handle response from Replicate API
    // The API typically returns a blob (binary image data) directly
    let imageBase64;
    const responseData = hfResponse.data;
    const contentType = hfResponse.headers["content-type"] || "";

    console.log("📦 Response Content-Type:", contentType);
    console.log("📦 Response data type:", typeof responseData);
    console.log("📦 Response data length:", responseData?.length || "N/A");
    console.log("📦 Response status:", hfResponse.status);

    // Check if response is binary image data (most common case)
    if (
      Buffer.isBuffer(responseData) ||
      responseData instanceof ArrayBuffer ||
      responseData instanceof Uint8Array
    ) {
      // First, check if it's actually a JSON error response disguised as binary
      try {
        const responseText = Buffer.from(responseData).toString("utf-8");
        // Check if it's JSON (error response)
        if (
          responseText.trim().startsWith("{") ||
          responseText.trim().startsWith("[")
        ) {
          const jsonData = JSON.parse(responseText);

          // If it's a prediction object (Replicate API pattern), we need to poll
          if (jsonData.id && jsonData.status) {
            console.log(
              "📋 Received prediction object, status:",
              jsonData.status
            );
            console.log("🆔 Prediction ID:", jsonData.id);

            // If status is "starting" or "processing", poll for result
            if (
              jsonData.status === "starting" ||
              jsonData.status === "processing"
            ) {
              console.log("⏳ Prediction is processing, polling for result...");
              const predictionId = jsonData.id;
              const predictionUrl =
                jsonData.urls?.get || `${REPLICATE_ENDPOINT}/${predictionId}`;

              // Poll for result (max 30 attempts, 2 seconds apart = 60 seconds max)
              let attempts = 0;
              const maxAttempts = 30;
              let finalPrediction = jsonData;

              while (
                attempts < maxAttempts &&
                (finalPrediction.status === "starting" ||
                  finalPrediction.status === "processing")
              ) {
                await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds
                attempts++;

                try {
                  const pollResponse = await axios.get(predictionUrl, {
                    headers: {
                      Authorization: `Bearer ${HF_TOKEN}`,
                    },
                    timeout: 10000,
                  });

                  finalPrediction = pollResponse.data;
                  console.log(
                    `🔄 Poll attempt ${attempts}/${maxAttempts}, status: ${finalPrediction.status}`
                  );

                  if (
                    finalPrediction.status === "succeeded" ||
                    finalPrediction.status === "failed"
                  ) {
                    break;
                  }
                } catch (pollError) {
                  console.error("❌ Polling error:", pollError.message);
                  // Continue polling despite error
                }
              }

              // Update jsonData with final prediction
              jsonData.status = finalPrediction.status;
              jsonData.output = finalPrediction.output;
              jsonData.error = finalPrediction.error;
            }

            // If status is "succeeded" and output exists, use it
            if (jsonData.status === "succeeded" && jsonData.output) {
              // Output might be an array of image URLs or base64 strings
              if (Array.isArray(jsonData.output) && jsonData.output[0]) {
                const output = jsonData.output[0];
                // If it's a URL, fetch it
                if (
                  typeof output === "string" &&
                  (output.startsWith("http://") ||
                    output.startsWith("https://"))
                ) {
                  console.log("📥 Fetching image from URL:", output);
                  const imageResponse = await axios.get(output, {
                    responseType: "arraybuffer",
                    timeout: 30000,
                  });
                  imageBase64 = Buffer.from(imageResponse.data).toString(
                    "base64"
                  );
                  console.log("✅ Fetched and converted image from URL");
                } else if (
                  typeof output === "string" &&
                  output.startsWith("data:")
                ) {
                  imageBase64 = output.split(",")[1]; // Extract base64 part
                  console.log("✅ Extracted base64 from data URI");
                } else if (typeof output === "string" && output.length > 100) {
                  imageBase64 = output; // Assume it's base64
                  console.log("✅ Using output as base64 string");
                } else {
                  throw new Error(
                    "Prediction succeeded but no valid image output found"
                  );
                }
                console.log("✅ Extracted image from prediction output");
              } else if (typeof jsonData.output === "string") {
                // Single string output (URL or base64)
                if (
                  jsonData.output.startsWith("http://") ||
                  jsonData.output.startsWith("https://")
                ) {
                  console.log("📥 Fetching image from URL:", jsonData.output);
                  const imageResponse = await axios.get(jsonData.output, {
                    responseType: "arraybuffer",
                    timeout: 30000,
                  });
                  imageBase64 = Buffer.from(imageResponse.data).toString(
                    "base64"
                  );
                  console.log("✅ Fetched and converted image from URL");
                } else {
                  imageBase64 = jsonData.output.startsWith("data:")
                    ? jsonData.output.split(",")[1]
                    : jsonData.output;
                  console.log("✅ Using output as base64 string");
                }
              } else {
                throw new Error(
                  "Prediction succeeded but output format is unexpected"
                );
              }
            } else if (jsonData.status === "failed") {
              const errorMsg = jsonData.error || "Image generation failed";
              console.error("❌ Prediction failed:", errorMsg);
              throw new Error(errorMsg);
            } else if (
              jsonData.status === "processing" ||
              jsonData.status === "starting"
            ) {
              // This shouldn't happen after polling, but handle it just in case
              throw new Error(
                `Image generation is still processing after polling. Status: ${jsonData.status}`
              );
            } else {
              throw new Error(
                `Unexpected prediction status: ${jsonData.status}`
              );
            }
          }
          // If it's an error object, throw it
          else if (jsonData.error || jsonData.message) {
            throw new Error(
              jsonData.error ||
                jsonData.message ||
                "Replicate API returned an error"
            );
          }
          // Otherwise, try to extract image from JSON
          else if (
            jsonData.images &&
            Array.isArray(jsonData.images) &&
            jsonData.images[0]
          ) {
            imageBase64 = jsonData.images[0];
            console.log("✅ Extracted image from JSON images array");
          } else if (jsonData.image) {
            imageBase64 = jsonData.image;
            console.log("✅ Extracted image from JSON image field");
          } else {
            // No image found in JSON, treat as binary
            imageBase64 = Buffer.from(responseData).toString("base64");
            console.log("✅ Treated response as binary image data");
          }
        } else {
          // It's actual binary image data (PNG/JPEG blob)
          imageBase64 = Buffer.from(responseData).toString("base64");
          console.log("✅ Extracted image from binary blob data");
        }
      } catch (parseError) {
        // If JSON parsing fails or throws, assume it's binary image data
        if (
          parseError.message.includes("processing") ||
          parseError.message.includes("Status:")
        ) {
          throw parseError; // Re-throw polling-related errors
        }
        imageBase64 = Buffer.from(responseData).toString("base64");
        console.log(
          "✅ Extracted image from binary data (after parse attempt)"
        );
      }
    }
    // Case 2: Response is JSON string
    else if (typeof responseData === "string") {
      try {
        const jsonData = JSON.parse(responseData);

        // Handle prediction object
        if (jsonData.id && jsonData.status) {
          console.log(
            "📋 Received prediction object, status:",
            jsonData.status
          );

          // If status is "starting" or "processing", poll for result
          if (
            jsonData.status === "starting" ||
            jsonData.status === "processing"
          ) {
            console.log("⏳ Prediction is processing, polling for result...");
            const predictionId = jsonData.id;
            const predictionUrl =
              jsonData.urls?.get || `${REPLICATE_ENDPOINT}/${predictionId}`;

            // Poll for result (max 30 attempts, 2 seconds apart = 60 seconds max)
            let attempts = 0;
            const maxAttempts = 30;
            let finalPrediction = jsonData;

            while (
              attempts < maxAttempts &&
              (finalPrediction.status === "starting" ||
                finalPrediction.status === "processing")
            ) {
              await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds
              attempts++;

              try {
                const pollResponse = await axios.get(predictionUrl, {
                  headers: {
                    Authorization: `Bearer ${HF_TOKEN}`,
                  },
                  timeout: 10000,
                });

                finalPrediction = pollResponse.data;
                console.log(
                  `🔄 Poll attempt ${attempts}/${maxAttempts}, status: ${finalPrediction.status}`
                );

                if (
                  finalPrediction.status === "succeeded" ||
                  finalPrediction.status === "failed"
                ) {
                  break;
                }
              } catch (pollError) {
                console.error("❌ Polling error:", pollError.message);
                // Continue polling despite error
              }
            }

            // Update jsonData with final prediction
            jsonData.status = finalPrediction.status;
            jsonData.output = finalPrediction.output;
            jsonData.error = finalPrediction.error;
          }

          if (jsonData.status === "succeeded" && jsonData.output) {
            const output = Array.isArray(jsonData.output)
              ? jsonData.output[0]
              : jsonData.output;
            if (typeof output === "string") {
              // If it's a URL, fetch it
              if (
                output.startsWith("http://") ||
                output.startsWith("https://")
              ) {
                console.log("📥 Fetching image from URL:", output);
                const imageResponse = await axios.get(output, {
                  responseType: "arraybuffer",
                  timeout: 30000,
                });
                imageBase64 = Buffer.from(imageResponse.data).toString(
                  "base64"
                );
                console.log("✅ Fetched and converted image from URL");
              } else {
                imageBase64 = output.startsWith("data:")
                  ? output.split(",")[1]
                  : output;
                console.log("✅ Extracted image from prediction output");
              }
            } else {
              throw new Error("Prediction output format is unexpected");
            }
          } else if (jsonData.status === "failed") {
            const errorMsg = jsonData.error || "Image generation failed";
            console.error("❌ Prediction failed:", errorMsg);
            throw new Error(errorMsg);
          } else if (
            jsonData.status === "processing" ||
            jsonData.status === "starting"
          ) {
            // This shouldn't happen after polling, but handle it just in case
            throw new Error(
              `Image generation is still processing after polling. Status: ${jsonData.status}`
            );
          } else {
            throw new Error(`Unexpected prediction status: ${jsonData.status}`);
          }
        }
        // Handle error
        else if (jsonData.error || jsonData.message) {
          throw new Error(
            jsonData.error || jsonData.message || "API returned an error"
          );
        }
        // Handle image in JSON
        else if (
          jsonData.images &&
          Array.isArray(jsonData.images) &&
          jsonData.images[0]
        ) {
          imageBase64 = jsonData.images[0];
          console.log("✅ Extracted image from JSON images array");
        } else if (jsonData.image) {
          imageBase64 = jsonData.image;
          console.log("✅ Extracted image from JSON image field");
        } else {
          throw new Error("No image data found in JSON response");
        }
      } catch (parseError) {
        throw parseError;
      }
    }
    // Case 3: Response is already a base64 string
    else if (typeof responseData === "string" && responseData.length > 100) {
      imageBase64 = responseData.replace(/^data:image\/\w+;base64,/, "");
      console.log("✅ Using response as base64 string");
    }
    // Case 4: Last resort
    else {
      console.log("⚠️ Unknown response format, attempting conversion");
      imageBase64 = Buffer.from(responseData).toString("base64");
    }

    // ✅ Validate that we got image data
    if (!imageBase64 || imageBase64.length === 0) {
      console.error("❌ No image data returned from Hugging Face");
      console.error("Response type:", typeof hfResponse.data);
      console.error("Response headers:", hfResponse.headers);
      return res.status(500).json({
        success: false,
        message: "No image data returned from Hugging Face API.",
      });
    }

    // Ensure base64 string doesn't have data URI prefix
    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const resultImage = `data:image/png;base64,${cleanBase64}`;

    console.log(
      "✅ Image generated successfully, size:",
      cleanBase64.length,
      "bytes"
    );

    // Deduct credit
    user.creditBalance = Math.max(0, user.creditBalance - 1);
    await user.save();

    // ✅ Success response
    return res.json({
      success: true,
      message: "Image generated successfully",
      creditBalance: user.creditBalance,
      resultImage,
    });
  } catch (error) {
    // 🧯 Catch and log Hugging Face or other errors
    let errorMessage = error.message || "Image generation failed";

    // Try to extract error message from response
    if (error.response) {
      const responseData = error.response.data;

      // Handle binary error responses (JSON error in binary format)
      if (
        Buffer.isBuffer(responseData) ||
        responseData instanceof ArrayBuffer
      ) {
        try {
          const errorText = Buffer.from(responseData).toString("utf-8");
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error || errorJson.message || errorMessage;
        } catch (e) {
          // If parsing fails, use default message
          errorMessage = errorMessage;
        }
      }
      // Handle JSON error responses
      else if (typeof responseData === "object" && responseData !== null) {
        errorMessage =
          responseData.error || responseData.message || errorMessage;
      }
      // Handle string error responses
      else if (typeof responseData === "string") {
        try {
          const errorJson = JSON.parse(responseData);
          errorMessage = errorJson.error || errorJson.message || errorMessage;
        } catch (e) {
          errorMessage = responseData || errorMessage;
        }
      }
    }

    console.error("❌ Hugging Face API Error:", errorMessage);
    console.error("❌ Full error:", error);
    if (error.response) {
      console.error("❌ Response status:", error.response.status);
      console.error("❌ Response headers:", error.response.headers);
    }

    return res.status(error.response?.status || 500).json({
      success: false,
      message:
        typeof errorMessage === "string"
          ? errorMessage
          : "Image generation failed",
    });
  }
};
