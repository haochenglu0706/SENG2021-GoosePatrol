const db = require("./db");
const {
    GetItemCommand,
    PutItemCommand,
    DeleteItemCommand,
    ScanCommand,
    UpdateItemCommand,
} = require("@aws-sdk/client-dynamodb");
const { marshall, unmarshall } = require("@aws-sdk/util-dynamodb");

const getPost = async (event) => {
    const response = { statusCode: 200 };

    try {
        
    } catch (e) {

    }
};