module.exports.handleErrors = (err) => {
    let errors = { phoneNumber: "", otp: "" };
  
    // Handle specific errors
    if (err.message.includes("Customer validation failed")) {
      // Loop over the error messages and assign them to the errors object
      Object.values(err.errors).forEach(({ properties }) => {
        errors[properties.path] = properties.message;
      });
    }
  
    // Handle duplicate key error for phone number (if you have unique indexes on phone numbers)
    if (err.code === 11000 && err.keyValue.phoneNumber) {
      errors.phoneNumber = "This phone number is already registered";
    }
  
    // Add more specific error handling as needed
    if (err.message === "Invalid or expired OTP") {
      errors.otp = "Invalid or expired OTP";
    }
  
    // Return the errors object
    return errors;
  };
  