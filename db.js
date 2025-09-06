const mongoose=require("mongoose")
const env=require("dotenv").config()
const connectDB=async()=>{
    try {
        await mongoose.connect(process.env.URI)
        console.log("connected to db we are good to go")
    } catch (error) {
        console.log(error)
    }
}
module.exports=connectDB
