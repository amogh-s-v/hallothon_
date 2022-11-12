const fs = require("fs");
var express = require("express");
var url = require("url");
var app = express();
var cors = require("cors");
app.use(cors());
const readline = require("readline");
const { google } = require("googleapis");
const SCOPES = ["https://www.googleapis.com/auth/drive"];
const TOKEN_PATH = "token.json";
var MongoClient = require("mongodb").MongoClient;

const PORT = 5000;

var authUrl = "";

var mongo_link =
  "mongodb+srv://hallothon:hallothon@cluster0.hddpmm6.mongodb.net/?retryWrites=true&w=majority";

// Load client secrets from a local file.
// fs.readFile('credentials.json', (err, content) => {
//     if (err) return console.log('Error loading client secret file:', err);
//     authorize(JSON.parse(content), listFiles);
// });

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
  const { client_secret, client_id, redirect_uris } = credentials.web;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getAccessToken(oAuth2Client, callback);
    oAuth2Client.setCredentials(JSON.parse(token));
    callback(oAuth2Client); //list files and upload file
    //callback(oAuth2Client, '0B79LZPgLDaqESF9HV2V3YzYySkE');//get file
  });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getAccessToken(oAuth2Client, callback) {
  authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });
  console.log("Authorize this app by visiting this url:", authUrl);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question("Enter the code from that page here: ", (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error("Error retrieving access token", err);
      oAuth2Client.setCredentials(token);
      // Store the token to disk for later program executions
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) return console.error(err);
        console.log("Token stored to", TOKEN_PATH);
      });
      callback(oAuth2Client);
    });
  });
}

/**
 * Lists the names and IDs of up to 10 files.
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */

function getList(auth, qword, cat_name, sub_name) {
  const drive = google.drive({ version: "v3", auth });
  pageToken = "";
  drive.files.list(
    {
      corpora: "user",
      pageSize: 10,
      q: `fullText contains '${qword}'`,
      pageToken: pageToken ? pageToken : "",
      fields: "nextPageToken, files(*)",
    },
    (err, res) => {
      if (err) return console.log("The API returned an error: " + err);
      const files = res.data.files;
      if (files.length) {
        console.log("Files:");
        processList(files, cat_name, sub_name);
        if (res.data.nextPageToken) {
          getList(drive, res.data.nextPageToken);
        }
      } else {
        console.log("No files found.");
      }
    }
  );
}
function processList(files, cat_name, sub_name) {
  console.log("Processing....");
  files.forEach((file) => {
    MongoClient.connect(mongo_link, async (err, client) => {
      if (err) throw err;
      var col = client.db("Hallothon").collection("hr_files");

      var myDocument = await col.findOne({ file_id: file.id });
      if (!myDocument) {
        col
          .insertOne({
            file_name: file.name,
            file_id: file.id,
            file_link: file.webViewLink,
            file_type: file.fullFileExtension,
            created_time: file.createdTime,
            modified_time: file.modifiedTime,
            cat_name: cat_name,
            sub_name: sub_name,
          })
          .then(() => {
            client.close();
          });
      }
    });
  });
}

function getWords(auth) {
  MongoClient.connect(mongo_link, async (err, client) => {
    if (err) throw err;
    var col = client.db("Hallothon").collection("cat_words");

    var word_list = col.find({}).toArray((err, res) => {
      if (err) return err;
      res.forEach((ele) => {
        var res_q = ele.words[0];
        for (let i = 1; i < ele.words.length; i++) {
          res_q += " and " + ele.words[i];
        }

        getList(auth, res_q, ele.cat_name, ele.sub_name);
      });
    });
  });
}

var app = express();
app.use(express.json());
app.use(express.urlencoded());

app.post("/login", (req, res) => {
  fs.readFile("credentials.json", (err, content) => {
    if (err) return console.log("Error loading client secret file:", err);

    authorize(JSON.parse(content), (auth) => {
      MongoClient.connect(mongo_link, async (err, client) => {
        if (err) throw err;
        var col = client.db("Hallothon").collection("hr_files");

        await col.remove({})
        getWords(auth);
      });
    });
  });
  res.send({ url: authUrl });
});

app.post("/categories", (req, res) => {
  MongoClient.connect(mongo_link, async (err, client) => {
    if (err) throw err;
    var col = client.db("Hallothon").collection("cat_words");

    var word_list = await col.find({}).toArray();

    var cats = [];
    word_list.forEach((ele) => {
      cats.push(ele.cat_name);
    });

    res.send({ cats: [...new Set(cats)] });
  });
});

app.post("/subs", (req, res) => {
  const { cat } = req.body;
  // console.log(cat)
  MongoClient.connect(mongo_link, async (err, client) => {
    if (err) throw err;
    var col = client.db("Hallothon").collection("cat_words");

    var word_list = await col.find({ cat_name: cat }).toArray();

    var subs = [];
    word_list.forEach((ele) => {
      subs.push(ele.sub_name);
    });

    res.send({ subs: subs });
  });
});

app.post("/table", (req, res) => {
  const { cat, sub } = req.body;

  MongoClient.connect(mongo_link, async (err, client) => {
    if (err) throw err;
    var col = client.db("Hallothon").collection("hr_files");

    var files;
    if (sub === "") files = await col.find({ cat_name: cat }).toArray();
    else files = await col.find({ cat_name: cat, sub_name: sub }).toArray();

    // console.log(files)

    res.send({ files: files });
  });
});

app.post("/lastmodi", (req, res) => {
  MongoClient.connect(mongo_link, async (err, client) => {
    if (err) throw err;
    var col = client.db("Hallothon").collection("hr_files");

    var files = await col.find({}).sort({modified_time: 1}).toArray();

    // console.log(files)

    res.send({ files: files });
  });
});

app.listen(PORT);
