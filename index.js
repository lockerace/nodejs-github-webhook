const fs = require('fs');
const express = require('express');
const crypto = require('crypto');
const { exec } = require('child_process');

function checkSignature(signature, config, body) {
  if (!signature) {
    throw new Error('No signature header found')
  }

  const hmac = crypto.createHmac('sha256', config.secret);
  hmac.update(JSON.stringify(body));
  const digest = `sha256=${hmac.digest('hex')}`;

  return digest !== signature
}

function processUpdate(req, res, config, githubEvent) {
  let key = req.body.repository.full_name + '/' + config.pingBranch;
  if (githubEvent != 'ping') {
    const parts = req.body.ref.split('/');
    const branchName = parts[parts.length - 1];
    key = req.body.repository.full_name + '/' + branchName;
  }

  let found = false
  for (let repo of config.repos) {
    if (repo.branch === key) {
      found = true

      const githubDeliveryId = req.headers['x-github-delivery'];
      console.log('delivery: ' + githubDeliveryId)

      res.status(200).send('OK');
      res.end();

      let cmds = [
        'cd ' + repo.gitRoot,
      ];
      cmds = [...cmds, ...(repo.cmds && repo.cmds.length > 0 ? repo.cmds : [])];
      const cmd = cmds.join('; ');
      console.log('(' + repo.name + ')');
      exec(cmd, (error, stdout, stderr) => {
        if (error) {
          console.error(`exec error: ${error}`);
          return;
        }
        if (stdout) console.log(stdout);
        if (stderr) console.error(stderr);
      });
      break;
    }
  }
  if (!found) {
    return res.status(404).send("Not found")
  } else {
    return
  }
}

function start() {
  const app = express();
  const port = process.env.PORT || 3000;

  app.use(express.json({ limit: process.env.APP_UPLOAD_LIMIT || '5mb' }));

  app.post('/', (req, res) => {
    fs.readFile('webhook-config.json', 'utf8', function (err, data) {
      if (err) {
        console.error(err)
        return res.status(204).end()
      }
      const config = JSON.parse(data);
      if (!config || !config.secret) {
        console.error('Invalid config')
        return res.status(204).end()
      }
      if (!config.repos || config.repos.length <= 0) return res.status(204).end()

      const githubEvent = req.headers['x-github-event'];
      if (githubEvent == 'push' || githubEvent == 'ping') {
        try {
          if (checkSignature(req.headers['x-hub-signature-256'], config, req.body)) {
            return res.status(401).send('Invalid signature');
          }

          processUpdate(req, res, config, githubEvent)
        } catch (err) {
          console.error(err)
          return res.status(500).send('ERROR')
        }
      }
    });
  });

  app.listen(port, () => {
    console.log(`Listening on port ${port}`);
  });
}

start();