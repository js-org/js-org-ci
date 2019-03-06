import {message, danger, fail} from "danger"

const {get} = require("https");
const getAsync = url => new Promise(resolve => get(url, resolve));

const activeFile = "cnames_active.js";

const modified = danger.git.modified_files;
const newFiles = danger.git.created_files;
const prTitle = danger.github.pr.title;

// puts the line into a JSON object, tries to parse and returns a JS object or undefined
function getJSON(line) {
  try {
    let record = JSON.parse(`{"_":"" ${line}}`);
    delete record._;
    return record;
  } catch (e) {}
}

const getKeyValue = (record) => {
  let recordKey = Object.keys(record)[0];
  return [recordKey, record[recordKey]];
}

function stripComments(line) {
  let lineCommentMatch = /\/\/.*/g.exec(line);
  if(lineCommentMatch) {
    line = line.substr(0, lineComment.index);
  }
  return [line.replace(/^\+/, '').trim(), lineCommentMatch]
}

// test wheather a redirect is in place and the target is correct
async function checkCNAME(domain, target) {
  const {
    headers,
    statusCode
  } = await getAsync(target);

  // Check status codes to see if redirect is done properly
  if(statusCode == 404)
    fail(`\`${target}\` responds with a 404 error`)
  else if(!(statusCode >= 300 && statusCode < 400))
    warn(`\`${target}\` has to redirect using a CNAME file`);
  
  // Check if the target redirect is correct
  const targetLocation = String(headers.location).replace(/^https/, "http").replace(/\/$/,'');
  if(!targetLocation) 
    warn(`\`${target}\` is not redirecting to \`${domain}\``)
  else if(targetLocation !== domain)
    warn(`\`${target}\` is redirecting to \`${targetLocation}\` instead of \`${domain}\``);
}

const result = async () => {
  
  // Check if cnames_active.js is modified.
  let isCNamesFileModified = modified.includes(activeFile);

  if(isCNamesFileModified)
    if(modified.length == 1)
      message(`:heavy_check_mark: Only file modified is \`${activeFile}\``)
    else
      warn(`Multiple files modified — ${modified.join(", ")}`)
  else
    fail(`\`${activeFile}\` not modified.`)


  // Check if PR title matches *.js.org
  let prTitleMatch = /^([\d\w]+?)\.js\.org$/.exec(prTitle)

  if(prTitleMatch)
    message(`:heavy_check_mark: Title of PR — \`${prTitle}\``)
  else
    warn(`Title of Pull Request is not in the format *myawesomeproject.js.org*`)

  
  // Check number of lines changed in diff
  let linesOfCode = await danger.git.linesOfCode();

  if(linesOfCode == 1)
    message(`:heavy_check_mark: Only one line added!`)    
  else
    fail(`More than one line added!`)


  // Check diff to see if code is added properly
  let diff = await danger.git.diffForFile(activeFile);
  let lineAdded = diff.added.substr(1), lineComment;

  // Check for comments
  [lineAdded, lineComment] = stripComments(lineAdded);
  if(lineComment) {
    warn(`Comment added to the cname file — \`${lineComment[0]}\``)

    // Do not allow noCF? comments
    if(!(lineComment[0].match("/\s*\/\/\s*noCF\s*\n/g)")))
      fail("You are using an invalid comment, please remove the same.");
  }


  const recordAdded = getJSON(lineAdded);
  if(!(typeof recordAdded === "object"))
    fail(`Could not parse \`${lineAdded}\``);
  else {
    // get the key and value of the record
    const [recordKey, recordValue] = getKeyValue(recordAdded);

    // Check if recordKey matches PR title
    if(prTitleMatch && prTitleMatch[1] != recordKey)
      warn("Hmmm.. your PR title doesn't seem to match your entry in the file.")

    // Check formatting (copy&paste from a browser adressbar often results in an URL)
    if(!(!recordValue.match(/(http(s?))\:\/\//gi) && !recordValue.endsWith("/")))
      fail("The target value should not start with 'http(s)://' and should not end with a '/'");

    // Check for an exact Regex match — this means the format is perfect
    if(!diff.added.match(/^\+\s{2},"[\da-z]+?":\s"[\S]+?"$/))
      warn("Not an *exact* regex match")

    // check if the target of of the record is a GitHub Page
    if (recordValue.match(/.github\.io/g)) {
      // check the presence of a CNAME
      await checkCNAME(`http://${recordKey}.js.org`, `https://${recordValue}`);
    }

    // Check if in alphabetic order
    let diffChunk = await danger.git.structuredDiffForFile(activeFile);
    diffChunk.chunks.map(chunk => {
      let diffLines = chunk.changes.map(lineObj => {
        let lineMatch = /"(.+?)"\s*?:/.exec(lineObj.content)
        if(lineMatch) return lineMatch[1];
      });
      diffLines.some((line, i) => {
        if (i)  // skip the first element
          if(!(`${line}`.localeCompare(`${diffLines[i - 1]}`) !== -1)) {
            fail("The list is no longer in alphabetic order.")
            return true;
          }
      })
    });
  }
}

// Exit in case of any error
result().catch(err => {
  console.error(`ERROR: ${err.message || err}`);
  console.info("Some CI tests have returned an error.");
  process.exit(1);
});
