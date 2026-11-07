# CalTopo credentials

A Service Account has its own Account ID, a Credential ID and a Credential Secret. The Team it belongs to has a separate
Team ID, visible in the URL of the Team admin page - the Outgoing flow needs both.

The `Team Account` mode requires a Service Account Credential ID and Secret from CalTopo.
You must be an admin of the CalTopo Team to create an access token.

1. Login to [CalTopo](https://caltopo.com) and click "Your Data" in the top bar

   ![Click your username](01_Get-Caltopo-Credentials.png)
2. In the popup, click on the team you wish to Administer / configure.

   ![Click Administer](02_Get-Caltopo-Credentials.png)
3. On the Team page, click the `Details` link.

   ![Click the Details tab](03_Get-Caltopo-Credentials.png)
4. On the Members Page, click the `Administer` link.

   ![Click the administrators link](04_Get-Caltopo-Credentials.png)
5. On the Team page, click the `Details` tab and then `Create Service Account` to create a new Service Account.

   ![Click the Details tab](05_Get-Caltopo-Credentials.png)
6. Create a new Service Account with at minimum `Read` permissions if you only want to receive data from Caltopo (one-way).  If you wish to send data from a TAK DataSync mission and TAK PLI, give it `Write` permissions.
7. Note / Copy the `Credential Secret` - you cannot access it after this without creating a new service account.

   ![Note Credential Secret](07_Get-Caltopo-Credentials.png)
8. After closing, note and save the other account information:
   - **Team ID:** From the URL between `.../group/` and `/admin/...`
   - **Account ID**
   - **Credential ID**

    ![Account information](08_Get-Caltopo-Credentials.png)
